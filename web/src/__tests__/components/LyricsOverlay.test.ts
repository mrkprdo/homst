import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { mount, flushPromises } from "@vue/test-utils"
import { nextTick } from "vue"
import LyricsOverlay from "@/components/shared/LyricsOverlay.vue"
import { useSpotify, type SpotifyTrack } from "@/composables/useSpotify"

const { currentTrack } = useSpotify()

function track(overrides: Partial<SpotifyTrack> = {}): SpotifyTrack {
  return {
    id: "t1",
    name: "The Chain",
    artists: "Fleetwood Mac",
    albumArt: "https://i.scdn.co/image/cover.jpg",
    progressMs: 0,
    durationMs: 284_000,
    isPlaying: true,
    ...overrides,
  }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })

const SYNCED = "[00:01.00]Listen to the wind\n[00:05.00]Watch the sun rise\n[00:09.00]Run in the shadows"

/** Let enter/leave transitions (two animation frames in jsdom) settle. */
async function settle() {
  await nextTick()
  await new Promise((resolve) => setTimeout(resolve, 100))
  await nextTick()
}

async function mountWithLyrics(syncedLyrics: string | null = SYNCED) {
  vi.mocked(fetch).mockResolvedValueOnce(json([
    { duration: 284, instrumental: false, syncedLyrics },
  ]))
  currentTrack.value = track()
  const wrapper = mount(LyricsOverlay)
  await flushPromises()
  await settle()
  return wrapper
}

function currentLine(wrapper: Awaited<ReturnType<typeof mountWithLyrics>>): string {
  return wrapper.findAll(".lyric").at(-1)?.text() ?? ""
}

function nextCue(wrapper: Awaited<ReturnType<typeof mountWithLyrics>>): string {
  return wrapper.findAll(".lyrics-next__line").at(-1)?.text() ?? ""
}

beforeEach(() => {
  currentTrack.value = null
})

// Shared module state: leave no track or pending effect behind for the next
// test, or a late watcher tick can steal that test's mocked fetch response.
afterEach(async () => {
  currentTrack.value = null
  await nextTick()
  await flushPromises()
})

describe("LyricsOverlay", () => {
  it("stays hidden while nothing plays and makes no request", () => {
    const wrapper = mount(LyricsOverlay)
    expect(wrapper.find(".lyrics").exists()).toBe(false)
    expect(vi.mocked(fetch)).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it("anchors the sung line and shows only the next one as a cue", async () => {
    const wrapper = await mountWithLyrics()

    expect(wrapper.findAll(".lyric")).toHaveLength(1)
    expect(currentLine(wrapper)).toBe("Listen to the wind")
    expect(nextCue(wrapper)).toBe("Watch the sun rise")

    // Intro: the opening line waits dimmed instead of claiming to be sung.
    expect(wrapper.find(".lyric--waiting").exists()).toBe(true)

    currentTrack.value = track({ progressMs: 1_500 })
    await settle()
    expect(currentLine(wrapper)).toBe("Listen to the wind")
    expect(wrapper.find(".lyric--waiting").exists()).toBe(false)
    expect(nextCue(wrapper)).toBe("Watch the sun rise")

    currentTrack.value = track({ progressMs: 6_000 })
    await settle()
    expect(currentLine(wrapper)).toBe("Watch the sun rise")
    expect(nextCue(wrapper)).toBe("Run in the shadows")

    // The reading position never turns into a scrolled sheet.
    expect(wrapper.find(".lyrics-track").exists()).toBe(false)
    expect(wrapper.find("[style*='translate3d(0, calc']").exists()).toBe(false)

    wrapper.unmount()
  })

  it("keeps following to the last line and then drops the cue", async () => {
    const wrapper = await mountWithLyrics()

    currentTrack.value = track({ progressMs: 20_000 })
    await settle()
    expect(currentLine(wrapper)).toBe("Run in the shadows")
    expect(currentLine(wrapper)).toBe("Run in the shadows")
    expect(wrapper.find(".lyrics-next__line").exists()).toBe(false)

    wrapper.unmount()
  })

  it("stays hidden for tracks without synced lyrics", async () => {
    const wrapper = await mountWithLyrics(null)

    expect(wrapper.find(".lyrics").exists()).toBe(false)
    wrapper.unmount()
  })

  it("fades away while playback is paused", async () => {
    const wrapper = await mountWithLyrics()
    expect(wrapper.find(".lyrics").exists()).toBe(true)

    currentTrack.value = track({ progressMs: 1_500, isPlaying: false })
    await settle()
    expect(wrapper.find(".lyrics").exists()).toBe(false)

    currentTrack.value = track({ progressMs: 5_500, isPlaying: true })
    await settle()
    expect(currentLine(wrapper)).toBe("Watch the sun rise")

    wrapper.unmount()
  })

  it("stops following Spotify once unmounted", async () => {
    const wrapper = await mountWithLyrics()
    const calls = vi.mocked(fetch).mock.calls.length
    wrapper.unmount()

    currentTrack.value = track({ id: "t2", name: "Dreams" })
    await flushPromises()
    expect(vi.mocked(fetch).mock.calls.length).toBe(calls)
  })
})
