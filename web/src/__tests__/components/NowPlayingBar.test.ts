import { describe, it, expect, afterEach } from "vitest"
import { nextTick } from "vue"
import { mount } from "@vue/test-utils"
import NowPlayingBar from "@/components/shared/NowPlayingBar.vue"
import { useSpotify } from "@/composables/useSpotify"

afterEach(() => {
  useSpotify().currentTrack.value = null
})

describe("NowPlayingBar", () => {
  it("renders nothing while no track is loaded", () => {
    const wrapper = mount(NowPlayingBar)
    expect(wrapper.find(".now-playing").exists()).toBe(false)
  })

  it("shows the title, artist, elapsed time and progress", () => {
    useSpotify().currentTrack.value = {
      id: "t1",
      name: "Night Drive",
      artists: "The Neons",
      albumArt: "https://example.test/night-drive.jpg",
      progressMs: 61_000,
      durationMs: 122_000,
      isPlaying: true,
    }

    const wrapper = mount(NowPlayingBar)

    expect(wrapper.find(".now-playing__title").text()).toBe("Night Drive")
    expect(wrapper.find(".now-playing__artist").text()).toContain("The Neons")
    expect(wrapper.find(".now-playing__time").text()).toBe("1:01/2:02")
    expect(wrapper.find(".now-playing__art").attributes("src")).toBe(
      "https://example.test/night-drive.jpg",
    )
    expect(wrapper.find(".now-playing__disc").classes()).not.toContain("now-playing__disc--paused")
    expect(wrapper.find(".now-playing__fill").attributes("style")).toContain("scaleX(0.5)")
    expect(wrapper.find(".now-playing").classes()).not.toContain("now-playing--paused")
  })

  it("dims the strip when playback is paused", () => {
    useSpotify().currentTrack.value = {
      id: "t2",
      name: "Almost There",
      artists: "Low Key",
      albumArt: "",
      progressMs: 0,
      durationMs: 0,
      isPlaying: false,
    }

    const wrapper = mount(NowPlayingBar)

    expect(wrapper.find(".now-playing").classes()).toContain("now-playing--paused")
    expect(wrapper.find(".now-playing__disc").classes()).toContain("now-playing__disc--paused")
    expect(wrapper.find(".now-playing__fill").attributes("style")).toContain("scaleX(0)")
  })

  it("marquees the title and artist when they do not fit", async () => {
    const track = {
      id: "t3",
      name: "A Song Title That Is Far Too Long",
      artists: "An Artist With A Long Name",
      albumArt: "",
      progressMs: 30_000,
      durationMs: 240_000,
      isPlaying: true,
    }
    useSpotify().currentTrack.value = { ...track }

    const wrapper = mount(NowPlayingBar)

    // jsdom has no layout: give the box a narrow width and the copy a long one.
    const box = wrapper.find(".now-playing__text").element as HTMLElement
    const copy = wrapper.find(".now-playing__copy").element as HTMLElement
    Object.defineProperty(box, "clientWidth", { configurable: true, value: 120 })
    Object.defineProperty(copy, "offsetWidth", { configurable: true, value: 360 })

    // The name watcher re-measures after the next render.
    useSpotify().currentTrack.value = { ...track, name: `${track.name}!` }
    await nextTick()

    expect(wrapper.find(".now-playing__text").classes()).toContain("now-playing__text--marquee")
    expect(wrapper.findAll(".now-playing__copy")).toHaveLength(2)
    expect(wrapper.find(".now-playing__line").attributes("style")).toContain(
      "--marquee-duration: 15s",
    )
  })
})
