import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { mount, flushPromises } from "@vue/test-utils"
import { nextTick } from "vue"
import CameraCard from "@/components/home/CameraCard.vue"
import { STALL_TIMEOUT_MS } from "@/composables/useCameraStream"
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

  it("shows the loader instead of an error when playback is unavailable", async () => {
    hls.FakeHls.supported = false
    configureCamera()

    const wrapper = mount(CameraCard)
    await flushPromises()
    await nextTick()

    expect(wrapper.find(".camera-video").exists()).toBe(true)
    expect(wrapper.find(".camera-backdrop").exists()).toBe(true)
    expect(wrapper.find(".camera-video").classes()).toContain("camera-video--rotate-90")
    expect(wrapper.find(".camera-overlay").exists()).toBe(true)
    expect(wrapper.find(".camera-overlay .ui-loader").exists()).toBe(true)
    expect(wrapper.find(".camera-status").text()).toBe("This browser cannot play HLS video.")
    expect(wrapper.find(".ui-btn").exists()).toBe(false)
    wrapper.unmount()
  })

  it("keeps the frame sharp while a slow stream re-buffers", async () => {
    vi.useFakeTimers()
    configureCamera()

    const wrapper = mount(CameraCard)
    await flushPromises()
    await nextTick()

    hls.instances.at(-1)!.handlers["manifest"]!("manifest", {})
    await nextTick()
    expect(wrapper.find(".camera-overlay").attributes("style")).toContain("display: none")

    await vi.advanceTimersByTimeAsync(STALL_TIMEOUT_MS)
    await nextTick()
    expect(wrapper.find(".camera-overlay").attributes("style")).not.toContain("display: none")
    expect(wrapper.find(".camera-overlay .ui-loader").exists()).toBe(true)
    expect(wrapper.find(".camera-status").text()).toBe("Reconnecting to camera")
    // Re-buffering does not blur the picture; only the loader signals it.
    expect(wrapper.find(".camera-video").classes()).not.toContain("camera-video--stalled")

    wrapper.unmount()
  })

  it("keeps the last frame while a failed stream reconnects", async () => {
    vi.useFakeTimers()
    configureCamera()

    const drawImage = vi.fn()
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      drawImage,
      save: vi.fn(),
      translate: vi.fn(),
      rotate: vi.fn(),
      restore: vi.fn(),
    } as unknown as CanvasRenderingContext2D)

    const wrapper = mount(CameraCard)
    await flushPromises()
    await nextTick()

    const video = wrapper.find(".camera-video").element as HTMLVideoElement
    Object.defineProperty(video, "videoWidth", { value: 1280, configurable: true })
    Object.defineProperty(video, "videoHeight", { value: 720, configurable: true })
    Object.defineProperty(video, "readyState", { value: 4, configurable: true })

    hls.instances.at(-1)!.handlers["manifest"]!("manifest", {})
    await nextTick()

    hls.instances.at(-1)!.handlers["error"]!("error", {
      fatal: true,
      type: "network",
      response: { code: 502, text: "" },
    })
    await nextTick()

    expect(drawImage).toHaveBeenCalled()
    expect(wrapper.find(".camera-still").exists()).toBe(true)
    expect(wrapper.find(".camera-still").attributes("style")).not.toContain("display: none")
    expect(wrapper.find(".camera-overlay .ui-loader").exists()).toBe(true)
    expect(wrapper.text()).not.toContain("Try again")

    // The frozen frame survives the reconnect and only gives way to live video.
    await vi.advanceTimersByTimeAsync(60_000)
    await nextTick()
    expect(wrapper.find(".camera-still").attributes("style")).not.toContain("display: none")

    hls.instances.at(-1)!.handlers["manifest"]!("manifest", {})
    await nextTick()
    expect(wrapper.find(".camera-still").attributes("style")).toContain("display: none")

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
      await vi.advanceTimersByTimeAsync(STALL_TIMEOUT_MS)
    }
    await nextTick()

    expect(wrapper.find(".camera-status").text()).toBe("Reconnecting to camera")
    expect(wrapper.find(".camera-overlay .ui-loader").exists()).toBe(true)

    const instancesBefore = hls.instances.length
    await vi.advanceTimersByTimeAsync(60_000)
    expect(hls.instances.length).toBe(instancesBefore + 1)
    expect(wrapper.find(".camera-status").text()).toBe("Connecting to camera")

    wrapper.unmount()
  })
})
