import { describe, it, expect, afterEach } from "vitest"
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
})
