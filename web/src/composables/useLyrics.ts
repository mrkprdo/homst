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
 * Follow the currently playing track and expose its timed lines. Called from
 * the overlay's setup, so the watcher stops with that component.
 */
function startLyrics(): void {
  const { currentTrack } = useSpotify()
  const { lyricsEnabled } = useSettings()
  const stop = watch(
    // Separate sources, not one getter returning an array: the array would be
    // a fresh reference on every check, so Vue would treat every Spotify poll
    // as a track change and blank the overlay (visible as flicker).
    [() => currentTrack.value?.id, () => lyricsEnabled.value],
    ([, enabled]) => { void load(enabled ? currentTrack.value : null) },
    { immediate: true },
  )
  onScopeDispose(stop)
}

/** Index of the line playing right now, or -1 during intros and breaks. */
const activeIndex = computed(() => {
  const track = useSpotify().currentTrack.value
  if (!track || !lines.value.length) return -1
  return activeLineIndex(lines.value, track.progressMs)
})

export function useLyrics() {
  return { lines, activeIndex, startLyrics }
}

export function _resetLyrics() {
  cache.clear()
  lines.value = []
  sequence++
}
