import { beforeEach, describe, expect, it, vi } from "vitest"
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

beforeEach(() => {
  currentTrack.value = null
})

describe("LyricsOverlay", () => {
  it("stays hidden while nothing plays and makes no request", () => {
    const wrapper = mount(LyricsOverlay)
    expect(wrapper.find(".lyrics").exists()).toBe(false)
    expect(vi.mocked(fetch)).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it("shows the current line and the next one, then scrolls on", async () => {
    const wrapper = await mountWithLyrics()
    const trackEl = wrapper.find(".lyrics-track").element

    // The sheet holds every line; the window reveals two at a time.
    expect(wrapper.findAll(".lyric-text").map(n => n.text())).toEqual([
      "Listen to the wind",
      "Watch the sun rise",
      "Run in the shadows",
    ])

    // Intro: the opening lines are a dim preview, nothing is highlighted.
    expect(wrapper.find(".lyric--now").exists()).toBe(false)
    expect(wrapper.find(".lyrics-track").attributes("style")).toContain("var(--lyric-row) * 0")

    currentTrack.value = track({ progressMs: 1_500 })
    await settle()
    expect(wrapper.find(".lyric--now").text()).toBe("Listen to the wind")
    expect(wrapper.find(".lyrics-track").attributes("style")).toContain("var(--lyric-row) * 0")

    currentTrack.value = track({ progressMs: 6_000 })
    await settle()
    expect(wrapper.find(".lyric--now").text()).toBe("Watch the sun rise")
    expect(wrapper.find(".lyrics-track").attributes("style")).toContain("var(--lyric-row) * -1")
    // The sheet must survive a poll, otherwise the slide restarts as a blink.
    expect(wrapper.find(".lyrics-track").element).toBe(trackEl)

    wrapper.unmount()
  })

  it("scrolls all the way to the last line", async () => {
    const wrapper = await mountWithLyrics()

    currentTrack.value = track({ progressMs: 20_000 })
    await settle()
    expect(wrapper.find(".lyric--now").text()).toBe("Run in the shadows")
    expect(wrapper.find(".lyrics-track").attributes("style")).toContain("var(--lyric-row) * -2")

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
    expect(wrapper.find(".lyric--now").text()).toBe("Watch the sun rise")

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
