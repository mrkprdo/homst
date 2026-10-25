import { beforeEach, describe, expect, it } from "vitest"
import { mount } from "@vue/test-utils"
import SpotifyBackdrop from "@/components/shared/SpotifyBackdrop.vue"
import { useSpotify, type SpotifyTrack } from "@/composables/useSpotify"
import { useSettings } from "@/composables/useSettings"

const { currentTrack } = useSpotify()

function track(overrides: Partial<SpotifyTrack> = {}): SpotifyTrack {
  return {
    id: "t1",
    name: "Midnight City",
    artists: "M83",
    albumArt: "https://i.scdn.co/image/cover.jpg",
    progressMs: 0,
    durationMs: 244000,
    isPlaying: true,
    ...overrides,
  }
}

const html = document.documentElement

describe("SpotifyBackdrop", () => {
  beforeEach(() => {
    currentTrack.value = null
    html.classList.remove("vinyl-backdrop")
  })

  it("covers the app with a spinning record while a track plays", async () => {
    currentTrack.value = track()
    const wrapper = mount(SpotifyBackdrop)
    await wrapper.vm.$nextTick()

    expect(wrapper.find(".vinyl-backdrop").exists()).toBe(true)
    expect(wrapper.find(".vinyl-art").attributes("style")).toContain("cover.jpg")
    // The shells key their translucent surfaces off this root class.
    expect(html.classList.contains("vinyl-backdrop")).toBe(true)

    wrapper.unmount()
    expect(html.classList.contains("vinyl-backdrop")).toBe(false)
  })

  it("stays out of the way when nothing is playing", async () => {
    currentTrack.value = track({ isPlaying: false })
    const wrapper = mount(SpotifyBackdrop)
    await wrapper.vm.$nextTick()

    expect(wrapper.find(".vinyl-backdrop").exists()).toBe(false)
    expect(html.classList.contains("vinyl-backdrop")).toBe(false)
    wrapper.unmount()
  })

  it("can hide the cover or keep it still", async () => {
    const { updateMusicBackground, updateMusicBackgroundSpin } = useSettings()
    currentTrack.value = track()

    updateMusicBackgroundSpin(false)
    let wrapper = mount(SpotifyBackdrop)
    await wrapper.vm.$nextTick()
    expect(wrapper.find(".vinyl-disc").classes()).toContain("vinyl-disc--still")
    wrapper.unmount()

    updateMusicBackground(false)
    wrapper = mount(SpotifyBackdrop)
    await wrapper.vm.$nextTick()
    expect(wrapper.find(".vinyl-backdrop").exists()).toBe(false)
    wrapper.unmount()
  })

  it("waits for album art before painting the background", () => {
    currentTrack.value = track({ albumArt: "" })
    const wrapper = mount(SpotifyBackdrop)

    expect(wrapper.find(".vinyl-backdrop").exists()).toBe(false)
    wrapper.unmount()
  })
})
