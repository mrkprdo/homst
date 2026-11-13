import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { effectScope, nextTick } from "vue"
import { flushPromises } from "@vue/test-utils"
import { _resetLyrics, useLyrics } from "@/composables/useLyrics"
import { useSpotify, type SpotifyTrack } from "@/composables/useSpotify"
import { useSettings } from "@/composables/useSettings"

const { currentTrack } = useSpotify()
const { lines, activeIndex, startLyrics } = useLyrics()

function track(overrides: Partial<SpotifyTrack> = {}): SpotifyTrack {
  return {
    id: "t1",
    name: "The Chain",
    artists: "Fleetwood Mac, Someone Else",
    albumArt: "https://i.scdn.co/image/cover.jpg",
    progressMs: 0,
    durationMs: 284_000,
    isPlaying: true,
    ...overrides,
  }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })

const record = (overrides: Record<string, unknown> = {}) => ({
  duration: 284,
  instrumental: false,
  syncedLyrics: "[00:01.00]first\n[00:03.00]second\n[00:05.00]third",
  ...overrides,
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => { resolve = res })
  return { promise, resolve }
}

let scope: ReturnType<typeof effectScope>

beforeEach(() => {
  currentTrack.value = null
  _resetLyrics()
  scope = effectScope()
  scope.run(() => startLyrics())
})

afterEach(() => scope.stop())

async function play(t: SpotifyTrack) {
  currentTrack.value = t
  await nextTick()
  await flushPromises()
}

describe("useLyrics", () => {
  it("loads synced lyrics for the playing track and follows the position", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json([record()]))

    expect(activeIndex.value).toBe(-1)
    await play(track())
    expect(lines.value.map(l => l.text)).toEqual(["first", "second", "third"])

    // The lead artist is what LRCLIB can match, not the joined list.
    const url = String(vi.mocked(fetch).mock.calls[0]![0])
    expect(url).toContain("https://lrclib.net/api/search")
    expect(url).toContain("track_name=The+Chain")
    expect(url).toContain("artist_name=Fleetwood+Mac")

    expect(activeIndex.value).toBe(-1)
    currentTrack.value = track({ progressMs: 3_500 })
    expect(activeIndex.value).toBe(1)
    currentTrack.value = track({ progressMs: 4_500 })
    expect(activeIndex.value).toBe(1)
    currentTrack.value = track({ progressMs: 9_000 })
    expect(activeIndex.value).toBe(2)
  })

  it("switches on the timestamp between the once-a-second Spotify samples", async () => {
    vi.useFakeTimers()
    try {
      vi.mocked(fetch).mockResolvedValueOnce(json([record()]))
      currentTrack.value = track({ progressMs: 2_800 })
      await nextTick()
      for (let i = 0; i < 12; i++) await Promise.resolve()

      expect(lines.value).toHaveLength(3)
      expect(activeIndex.value).toBe(0)

      // The next sample is a second away; the local clock should cross the
      // 3s line before Spotify reports again.
      vi.advanceTimersByTime(250)
      await nextTick()
      expect(activeIndex.value).toBe(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it("applies the household delay: negative starts early, positive runs late", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json([record()]))
    await play(track({ progressMs: 2_900 }))

    // 2.9s plus the built-in 120ms lead is already past the 3s line.
    expect(activeIndex.value).toBe(1)

    const { updateLyricsOffset } = useSettings()
    updateLyricsOffset(200)
    expect(activeIndex.value).toBe(0)

    updateLyricsOffset(-200)
    expect(activeIndex.value).toBe(1)

    updateLyricsOffset(0)
    expect(activeIndex.value).toBe(1)
  })

  it("prefers the record closest in length to the Spotify track", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json([
      record({ duration: 288, syncedLyrics: "[00:01.00]radio edit" }),
      record({ duration: 284.4, syncedLyrics: "[00:01.00]album version" }),
    ]))

    await play(track())
    expect(lines.value.map(l => l.text)).toEqual(["album version"])
  })

  it("skips instrumental and unsynced records, and wild duration mismatches", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json([
      record({ instrumental: true }),
      record({ syncedLyrics: null }),
      record({ duration: 120 }),
      null,
    ]))

    await play(track())
    expect(lines.value).toEqual([])
  })

  it("caches a track for the rest of the session, including 'no lyrics'", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json([record()]))
    await play(track())
    expect(lines.value).toHaveLength(3)

    // Local files have no Spotify id; the title/artist pair is the fallback key.
    vi.mocked(fetch).mockResolvedValueOnce(json([record()]))
    await play(track({ id: "", name: "Local File" }))
    await play(track())
    await play(track({ id: "", name: "Local File" }))
    expect(lines.value).toHaveLength(3)
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2)

    // Leave the track, come back: no second request.
    await play(track({ id: "t2", name: "Dreams" }))
    await play(track())
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(3)
    expect(lines.value).toHaveLength(3)

    // A cached empty answer also short-circuits.
    vi.mocked(fetch).mockClear()
    _resetLyrics()
    vi.mocked(fetch).mockResolvedValueOnce(json([]))
    await play(track({ id: "t3", name: "Instrumental" }))
    await play(track())
    await play(track({ id: "t3", name: "Instrumental" }))
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2)
    expect(lines.value).toEqual([])
  })

  it("retries a track that failed with a server error instead of caching it", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ statusCode: 503 }, 503))
    await play(track())
    expect(lines.value).toEqual([])

    vi.mocked(fetch).mockResolvedValueOnce(json([record()]))
    await play(track({ id: "t2" }))
    vi.mocked(fetch).mockResolvedValueOnce(json([record()]))
    await play(track())
    expect(lines.value).toHaveLength(3)
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(3)
  })

  it("keeps the lyrics on screen when Spotify re-polls the same track", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json([record()]))
    await play(track())
    expect(lines.value).toHaveLength(3)

    // The 5-second poll swaps in a fresh track object with the same id.
    currentTrack.value = track({ progressMs: 1_200 })
    await nextTick()
    await flushPromises()

    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1)
    expect(lines.value).toHaveLength(3)
  })

  it("skips the lookup while lyrics are turned off and clears what is on screen", async () => {
    const { lyricsEnabled } = useSettings()
    lyricsEnabled.value = false

    await play(track())
    expect(vi.mocked(fetch)).not.toHaveBeenCalled()
    expect(lines.value).toEqual([])

    // Switching the overlay back on picks the current track up again.
    vi.mocked(fetch).mockResolvedValueOnce(json([record()]))
    lyricsEnabled.value = true
    await nextTick()
    await flushPromises()
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1)
    expect(lines.value).toHaveLength(3)

    // And turning it off mid-song clears the screen.
    lyricsEnabled.value = false
    await nextTick()
    await flushPromises()
    expect(lines.value).toEqual([])
  })

  it("shows nothing when the response is not a result list or the network fails", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ nope: true }))
    await play(track())
    expect(lines.value).toEqual([])

    vi.mocked(fetch).mockRejectedValueOnce(new Error("offline"))
    await play(track({ id: "t9" }))
    expect(lines.value).toEqual([])
  })

  it("ignores a lookup that finishes after the track changed", async () => {
    const slow = deferred<Response>()
    const fast = deferred<Response>()
    vi.mocked(fetch)
      .mockReturnValueOnce(slow.promise)
      .mockReturnValueOnce(fast.promise)

    await play(track({ id: "slow" }))
    await play(track({ id: "fast" }))

    fast.resolve(json([record({ syncedLyrics: "[00:01.00]fast song" })]))
    await flushPromises()
    slow.resolve(json([record({ syncedLyrics: "[00:01.00]slow song" })]))
    await flushPromises()

    expect(lines.value.map(l => l.text)).toEqual(["fast song"])
  })

  it("clears the lines when playback stops and drops the oldest cache entries", async () => {
    // Fresh Response per request: a body can only be read once.
    vi.mocked(fetch).mockImplementation(() => Promise.resolve(json([record()])))

    await play(track())
    expect(lines.value).toHaveLength(3)

    currentTrack.value = null
    await nextTick()
    await flushPromises()
    expect(lines.value).toEqual([])

    // Past the cache cap the oldest key is dropped; the newest still hits.
    for (let i = 0; i < 205; i++) {
      await play(track({ id: `bulk-${i}` }))
    }
    await play(track({ id: "elsewhere" }))
    vi.mocked(fetch).mockClear()
    await play(track({ id: "bulk-204" }))
    expect(vi.mocked(fetch)).not.toHaveBeenCalled()
  })
})
