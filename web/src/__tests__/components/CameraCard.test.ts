import { describe, it, expect, vi, beforeEach } from "vitest"
import { mount, flushPromises } from "@vue/test-utils"
import { nextTick } from "vue"
import CameraCard from "@/components/home/CameraCard.vue"
import { useSettings } from "@/composables/useSettings"

vi.mock("hls.js", () => ({
  default: class {
    static isSupported() {
      return false
    }
    static Events = {}
    static ErrorTypes = {}
  },
}))

const STREAM = "/api/v1/camera/hls/0123456789abcdef/index.m3u8"

describe("CameraCard", () => {
  beforeEach(() => {
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined)
    vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {})
    vi.spyOn(HTMLMediaElement.prototype, "canPlayType").mockReturnValue("")
  })

  it("shows the setup hint for an unconfigured camera", async () => {
    const settings = useSettings()
    settings.applyCameraSettings(null)

    const wrapper = mount(CameraCard)
    await flushPromises()

    expect(wrapper.text()).toContain("Add a camera")
    expect(wrapper.text()).toContain("Paste an RTSP URL in Settings")
    expect(wrapper.find(".block-header .ui-btn").exists()).toBe(false)
    wrapper.unmount()
  })

  it("shows a playback error and retries the configured stream", async () => {
    const settings = useSettings()
    settings.applyCameraSettings({
      url: "rtsp://192.168.1.20:554/stream1",
      username: "admin",
      passwordSet: true,
      rotation: 90,
      streamPath: STREAM,
    })

    const wrapper = mount(CameraCard)
    await flushPromises()
    await nextTick()

    expect(wrapper.find(".camera-video").exists()).toBe(true)
    expect(wrapper.find(".camera-video").classes()).toContain("camera-video--rotate-90")
    expect(wrapper.find(".camera-error").text()).toBe("This browser cannot play HLS video.")

    await wrapper.find(".camera-overlay .ui-btn").trigger("click")
    await flushPromises()
    expect(wrapper.find(".camera-error").exists()).toBe(true)
    wrapper.unmount()
  })
})
