import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { mount, flushPromises } from "@vue/test-utils"
import { nextTick } from "vue"
import CameraCard from "@/components/home/CameraCard.vue"
import { useSettings } from "@/composables/useSettings"

const hls = vi.hoisted(() => {
  const instances: any[] = []
  class FakeHls {
    static supported = true
    static isSupported() {
      return FakeHls.supported
    }
    static Events = {
      ERROR: "error",
      MANIFEST_PARSED: "manifest",
      FRAG_LOADED: "frag",
    }
    static ErrorTypes = { NETWORK_ERROR: "network", MEDIA_ERROR: "media" }
    handlers: Record<string, (event: string, data: any) => void> = {}
    constructor(_config: any) {
      instances.push(this)
    }
    on(event: string, cb: any) {
      this.handlers[event] = cb
    }
    loadSource() {}
    attachMedia() {}
    startLoad() {}
    recoverMediaError() {}
    destroy() {}
  }
  return { FakeHls, instances }
})

vi.mock("hls.js", () => ({ default: hls.FakeHls }))

const STREAM = "/api/v1/camera/hls/0123456789abcdef/index.m3u8"

function configureCamera() {
  const settings = useSettings()
  settings.applyCameraSettings({
    url: "rtsp://192.168.1.20:554/stream1",
    username: "admin",
    passwordSet: true,
    rotation: 90,
    streamPath: STREAM,
  })
  return settings
}

describe("CameraCard", () => {
  beforeEach(() => {
    hls.instances.length = 0
    hls.FakeHls.supported = true
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined)
    vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {})
    vi.spyOn(HTMLMediaElement.prototype, "canPlayType").mockReturnValue("")
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
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
    hls.FakeHls.supported = false
    configureCamera()

    const wrapper = mount(CameraCard)
    await flushPromises()
    await nextTick()

    expect(wrapper.find(".camera-video").exists()).toBe(true)
    expect(wrapper.find(".camera-backdrop").exists()).toBe(true)
    expect(wrapper.find(".camera-video").classes()).toContain("camera-video--rotate-90")
    expect(wrapper.find(".camera-error").text()).toBe("This browser cannot play HLS video.")

    await wrapper.find(".camera-overlay .ui-btn").trigger("click")
    await flushPromises()
    expect(wrapper.find(".camera-error").exists()).toBe(true)
    wrapper.unmount()
  })

  it("blurs the last frame while retrieving a stalled stream", async () => {
    vi.useFakeTimers()
    configureCamera()

    const wrapper = mount(CameraCard)
    await flushPromises()
    await nextTick()

    hls.instances.at(-1)!.handlers["manifest"]!("manifest", {})
    await nextTick()
    expect(wrapper.find(".camera-overlay").exists()).toBe(false)

    await vi.advanceTimersByTimeAsync(6_000)
    await nextTick()
    expect(wrapper.text()).toContain("retrieving stream...")
    expect(wrapper.find(".camera-video").classes()).toContain("camera-video--stalled")

    wrapper.unmount()
  })

  it("reports a failed retrieval and keeps retrying", async () => {
    vi.useFakeTimers()
    configureCamera()

    const wrapper = mount(CameraCard)
    await flushPromises()
    await nextTick()

    hls.instances.at(-1)!.handlers["manifest"]!("manifest", {})
    await nextTick()

    for (let attempt = 0; attempt < 4; attempt++) {
      await vi.advanceTimersByTimeAsync(5_000)
    }
    await nextTick()

    expect(wrapper.text()).toContain("failed retrieving stream")
    expect(wrapper.find(".camera-video").classes()).toContain("camera-video--stalled")

    const instancesBefore = hls.instances.length
    await vi.advanceTimersByTimeAsync(60_000)
    expect(hls.instances.length).toBe(instancesBefore + 1)
    expect(wrapper.text()).toContain("Connecting…")

    wrapper.unmount()
  })
})
