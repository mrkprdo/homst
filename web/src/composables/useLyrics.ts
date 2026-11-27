import { computed, onScopeDispose, ref, watch } from "vue"
import { useSpotify, type SpotifyTrack } from "@/composables/useSpotify"
import { useSettings } from "@/composables/useSettings"
import { activeLineIndex, parseLrc, type LyricLine } from "@/lib/lrc"

const LRCLIB_SEARCH = "https://lrclib.net/api/search"

const DURATION_TOLERANCE_S = 4

const cache = new Map<string, LyricLine[]>()

const lines = ref<LyricLine[]>([])

let sequence = 0

interface LrclibRecord {
  duration?: number
  instrumental?: boolean
  syncedLyrics?: string | null
}

function cacheKey(track: SpotifyTrack): string {
  return track.id || `${track.name}|${track.artists}`
}

function pickRecord(rows: unknown, durationS: number): LrclibRecord | null {
  if (!Array.isArray(rows)) return null

  let best: LrclibRecord | null = null
  let bestDelta = DURATION_TOLERANCE_S

  for (const row of rows as LrclibRecord[]) {
    if (!row || row.instrumental) continue
    if (typeof row.syncedLyrics !== "string" || !row.syncedLyrics) continue
    const delta = Math.abs(Number(row.duration) - durationS)
    if (!Number.isFinite(delta) || delta > bestDelta) continue
    best = row
    bestDelta = delta
  }

  return best
}

async function lookup(track: SpotifyTrack): Promise<LyricLine[]> {
  const key = cacheKey(track)
  const hit = cache.get(key)
  if (hit) return hit

  const params = new URLSearchParams({
    track_name: track.name,
    artist_name: track.artists.split(",")[0]!.trim(),
  })

  const res = await fetch(`${LRCLIB_SEARCH}?${params.toString()}`)
  if (!res.ok) return []

  const found = pickRecord(await res.json(), track.durationMs / 1000)

  const parsed = found?.syncedLyrics ? parseLrc(found.syncedLyrics) : []
  if (cache.size > 200) cache.clear()
  cache.set(key, parsed)
  return parsed
}

async function load(track: SpotifyTrack | null | undefined): Promise<void> {
  const seq = ++sequence
  lines.value = []
  if (!track) return

  const found = await lookup(track).catch(() => [] as LyricLine[])
  if (seq !== sequence) return
  lines.value = found
}

const clock = ref(Date.now())
const anchorProgressMs = ref(0)
const anchorAt = ref(Date.now())
let clockTimer: ReturnType<typeof setInterval> | null = null

const LINE_LEAD_MS = 120

const CLOCK_TICK_MS = 200

function startClock(): void {
  if (clockTimer !== null) return
  clock.value = Date.now()
  clockTimer = setInterval(() => { clock.value = Date.now() }, CLOCK_TICK_MS)
}

function stopClock(): void {
  if (clockTimer === null) return
  clearInterval(clockTimer)
  clockTimer = null
}

function anchor(track: SpotifyTrack | null | undefined): void {
  if (!track) return
  anchorProgressMs.value = track.progressMs
  anchorAt.value = Date.now()
  clock.value = anchorAt.value
}

function startLyrics(): void {
  const { currentTrack } = useSpotify()
  const { lyricsEnabled } = useSettings()
  const stopLoad = watch(
    [() => currentTrack.value?.id, () => lyricsEnabled.value],
    ([, enabled]) => { void load(enabled ? currentTrack.value : null) },
    { immediate: true },
  )
  const stopPlayback = watch(
    () => [currentTrack.value?.id, currentTrack.value?.isPlaying] as const,
    ([, playing]) => {
      if (!playing) {
        stopClock()
        return
      }
      anchor(currentTrack.value)
      startClock()
    },
    { immediate: true, flush: "sync" },
  )
  const stopProgress = watch(
    () => currentTrack.value?.progressMs,
    () => anchor(currentTrack.value),
    { flush: "sync" },
  )
  onScopeDispose(() => {
    stopLoad()
    stopPlayback()
    stopProgress()
    stopClock()
  })
}

const activeIndex = computed(() => {
  const track = useSpotify().currentTrack.value
  if (!track || !lines.value.length) return -1

  const elapsed = track.isPlaying ? Math.max(0, clock.value - anchorAt.value) : 0
  const offsetMs = useSettings().lyricsOffsetMs.value
  const positionMs = Math.max(
    0,
    Math.min(
      anchorProgressMs.value + elapsed + LINE_LEAD_MS - offsetMs,
      track.durationMs,
    ),
  )
  return activeLineIndex(lines.value, positionMs)
})

export function useLyrics() {
  return { lines, activeIndex, startLyrics }
}

export function _resetLyrics() {
  cache.clear()
  lines.value = []
  sequence++
  stopClock()
  anchorProgressMs.value = 0
  anchorAt.value = Date.now()
  clock.value = anchorAt.value
}
