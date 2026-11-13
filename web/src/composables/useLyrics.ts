import { computed, onScopeDispose, ref, watch } from "vue"
import { useSpotify, type SpotifyTrack } from "@/composables/useSpotify"
import { useSettings } from "@/composables/useSettings"
import { activeLineIndex, parseLrc, type LyricLine } from "@/lib/lrc"

/**
 * Lyrics come from LRCLIB (https://lrclib.net), which is free, needs no key and
 * returns the LRC timings Spotify's own API never exposes. Only records with
 * synced lyrics are usable here — an unsynced or missing record means no
 * overlay at all.
 */
const LRCLIB_SEARCH = "https://lrclib.net/api/search"

/** Spotify and LRCLIB versions may differ by a few seconds (radio edits, fades). */
const DURATION_TOLERANCE_S = 4

/** Replaying a track in the same session must not hit the network again. */
const cache = new Map<string, LyricLine[]>()

const lines = ref<LyricLine[]>([])

/** Invalidates in-flight lookups when the track changes mid-request. */
let sequence = 0

interface LrclibRecord {
  duration?: number
  instrumental?: boolean
  syncedLyrics?: string | null
}

function cacheKey(track: SpotifyTrack): string {
  return track.id || `${track.name}|${track.artists}`
}

/** Pick the record closest in length, ignoring instrumental and unsynced ones. */
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
    // "A, B" matches nothing; the lead artist is what LRCLIB indexes.
    artist_name: track.artists.split(",")[0]!.trim(),
  })

  const res = await fetch(`${LRCLIB_SEARCH}?${params.toString()}`)
  // 503 means LRCLIB is overloaded. Leave it uncached so a later play retries.
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

/**
 * The Spotify poll refreshes `progressMs` roughly once a second, so reading
 * the raw value switches each line up to a second late. Anchor the last known
 * position to a wall clock and interpolate while playing; the overlay then
 * changes lines on the timestamp rather than on the next poll.
 */
const clock = ref(Date.now())
const anchorProgressMs = ref(0)
const anchorAt = ref(Date.now())
let clockTimer: ReturnType<typeof setInterval> | null = null

/** Spotify's reported position trails real playback slightly; a small lead
 * puts the line change on the beat instead of just after it. */
const LINE_LEAD_MS = 120

function startClock(): void {
  if (clockTimer !== null) return
  clock.value = Date.now()
  clockTimer = setInterval(() => { clock.value = Date.now() }, 100)
}

function stopClock(): void {
  if (clockTimer === null) return
  clearInterval(clockTimer)
  clockTimer = null
}

/** Record a known playback position at the moment it was observed. */
function anchor(track: SpotifyTrack | null | undefined): void {
  if (!track) return
  anchorProgressMs.value = track.progressMs
  anchorAt.value = Date.now()
  clock.value = anchorAt.value
}

/**
 * Follow the currently playing track and expose its timed lines. Called from
 * the overlay's setup, so the watchers stop with that component.
 */
function startLyrics(): void {
  const { currentTrack } = useSpotify()
  const { lyricsEnabled } = useSettings()
  const stopLoad = watch(
    // Separate sources, not one getter returning an array: the array would be
    // a fresh reference on every check, so Vue would treat every Spotify poll
    // as a track change and blank the overlay (visible as flicker).
    [() => currentTrack.value?.id, () => lyricsEnabled.value],
    ([, enabled]) => { void load(enabled ? currentTrack.value : null) },
    { immediate: true },
  )
  // Play, pause and track changes re-anchor the interpolated position. While
  // paused the elapsed time would include the pause, and after a seek it would
  // count from the old spot, so neither can be carried across.
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

/** Index of the line playing right now, or -1 during intros and breaks. */
const activeIndex = computed(() => {
  const track = useSpotify().currentTrack.value
  if (!track || !lines.value.length) return -1

  // Reading `clock` makes this recompute between Spotify samples.
  const elapsed = track.isPlaying ? Math.max(0, clock.value - anchorAt.value) : 0
  // The household offset is a delay: positive holds the line back, negative
  // starts it earlier.
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
