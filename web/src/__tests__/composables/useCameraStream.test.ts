import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { defineComponent, h, nextTick, ref, type Ref } from "vue"
import { mount } from "@vue/test-utils"
import { useCameraStream } from "@/composables/useCameraStream"

const hls = vi.hoisted(() => {
  const instances: any[] = []
  class FakeHls {
    static supported = true
    static isSupported() {
      return FakeHls.supported
    }
    static Events = { ERROR: "error", MANIFEST_PARSED: "manifest" }
    static ErrorTypes = { NETWORK_ERROR: "network", MEDIA_ERROR: "media" }
    config: any
    handlers: Record<string, (event: string, data: any) => void> = {}
    loaded = ""
    attached = false
    startLoads = 0
    recoveries = 0
    destroyed = false
    constructor(config: any) {
      this.config = config
      instances.push(this)
    }
    on(event: string, cb: any) {
      this.handlers[event] = cb
    }
    loadSource(src: string) {
      this.loaded = src
    }
    attachMedia() {
      this.attached = true
    }
    startLoad() {
      this.startLoads++
    }
    recoverMediaError() {
      this.recoveries++
    }
    destroy() {
      this.destroyed = true
    }
  }
  return { FakeHls, instances }
})

vi.mock("hls.js", () => ({ default: hls.FakeHls }))

function mountStream(path: Ref<string | null>, withVideo = true) {
  let api!: ReturnType<typeof useCameraStream>
  const Comp = defineComponent({
    setup() {
      api = useCameraStream(path)
      return () => (withVideo ? h("video", { ref: api.video }) : h("div"))
    },
  })
  const wrapper = mount(Comp, { attachTo: document.body })
  return { wrapper, api }
}

describe("useCameraStream", () => {
  beforeEach(() => {
    hls.instances.length = 0
    hls.FakeHls.supported = true
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined)
    vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {})
    vi.spyOn(HTMLMediaElement.prototype, "canPlayType").mockReturnValue("")
  })

  afterEach(() => {
    vi.restoreAllMocks()
    document.body.innerHTML = ""
  })

  it("stays idle when there is no stream or no video element", async () => {
    const path = ref<string | null>(null)
    const { wrapper, api } = mountStream(path)
    expect(api.status.value).toBe("idle")

    path.value = "/api/v1/camera/hls/token/index.m3u8"
    await nextTick()
    expect(api.status.value).toBe("loading")
    expect(hls.instances).toHaveLength(1)
    wrapper.unmount()

    const noVideo = mountStream(ref("/api/v1/camera/hls/token/index.m3u8"), false)
    await nextTick()
    expect(noVideo.api.status.value).toBe("idle")
    noVideo.wrapper.unmount()
  })

  it("plays native HLS and swallows a rejected play promise", async () => {
    vi.mocked(HTMLMediaElement.prototype.canPlayType).mockReturnValue("maybe")
    vi.mocked(HTMLMediaElement.prototype.play).mockRejectedValue(new Error("blocked"))

    const path = ref("/native.m3u8")
    const { wrapper, api } = mountStream(path)
    await nextTick()
    await Promise.resolve()

    expect(api.status.value).toBe("playing")
    const video = wrapper.find("video").element as HTMLVideoElement
    expect(video.getAttribute("src")).toBe("/native.m3u8")
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalled()
    wrapper.unmount()
  })

  it("uses hls.js and retries a transient network error once", async () => {
    const path = ref("/live.m3u8")
    const { wrapper, api } = mountStream(path)
    await nextTick()

    expect(api.status.value).toBe("loading")
    const instance = hls.instances[0]
    expect(instance.config.lowLatencyMode).toBe(true)
    expect(instance.loaded).toBe("/live.m3u8")
    expect(instance.attached).toBe(true)

    instance.handlers["manifest"]!("manifest", {})
    expect(api.status.value).toBe("playing")
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalled()

    instance.handlers["error"]!("error", { fatal: false, type: "network" })
    expect(instance.startLoads).toBe(0)

    instance.handlers["error"]!("error", { fatal: true, type: "network" })
    expect(instance.startLoads).toBe(1)

    instance.handlers["error"]!("error", { fatal: true, type: "network" })
    expect(api.status.value).toBe("error")
    expect(api.error.value).toBe("Could not reach the camera stream. Check the URL and credentials in Settings.")
    expect(instance.destroyed).toBe(true)

    wrapper.unmount()
  })

  it("shows the server's camera error detail", async () => {
    const path = ref("/live.m3u8")
    const { wrapper, api } = mountStream(path)
    await nextTick()

    hls.instances[0].handlers["error"]!("error", {
      fatal: true,
      type: "network",
      response: { code: 503, text: JSON.stringify({ detail: "Camera streaming needs ffmpeg." }) },
    })
    expect(api.error.value).toBe("Camera streaming needs ffmpeg.")
    wrapper.unmount()
  })

  it("maps non-JSON network failures to friendly messages", async () => {
    const cases = [
      { code: 404, text: "not json", expected: "Camera stream not found. Check the camera URL in Settings." },
      { code: 503, text: "", expected: "Camera streaming is unavailable. Check that ffmpeg is installed on the server." },
      { code: 500, text: "", expected: "Could not reach the camera stream. Check the URL and credentials in Settings." },
    ]
    for (const item of cases) {
      const { wrapper, api } = mountStream(ref("/live.m3u8"))
      await nextTick()
      hls.instances.at(-1)!.handlers["error"]!("error", {
        fatal: true,
        type: "network",
        response: { code: item.code, text: item.text },
      })
      expect(api.error.value).toBe(item.expected)
      wrapper.unmount()
    }
  })

  it("recovers a media error once, then reports it", async () => {
    const path = ref("/live.m3u8")
    const { wrapper, api } = mountStream(path)
    await nextTick()

    const instance = hls.instances[0]
    instance.handlers["error"]!("error", { fatal: true, type: "media" })
    expect(instance.recoveries).toBe(1)
    expect(api.status.value).toBe("loading")

    instance.handlers["error"]!("error", { fatal: true, type: "media" })
    expect(api.status.value).toBe("error")
    expect(api.error.value).toContain("camera stream stopped")
    expect(instance.destroyed).toBe(true)
    wrapper.unmount()
  })

  it("reports an unrecoverable hls.js error", async () => {
    const path = ref("/live.m3u8")
    const { wrapper, api } = mountStream(path)
    await nextTick()

    hls.instances[0].handlers["error"]!("error", { fatal: true, type: "other" })
    expect(api.status.value).toBe("error")
    expect(api.error.value).toContain("camera stream stopped")
    wrapper.unmount()
  })

  it("reports browsers that cannot play HLS", async () => {
    hls.FakeHls.supported = false
    const path = ref("/live.m3u8")
    const { wrapper, api } = mountStream(path)
    await nextTick()

    expect(api.status.value).toBe("error")
    expect(api.error.value).toBe("This browser cannot play HLS video.")
    wrapper.unmount()
  })

  it("times out a stream that never produces a manifest", async () => {
    vi.useFakeTimers()
    try {
      const path = ref("/live.m3u8")
      const { wrapper, api } = mountStream(path)
      await nextTick()
      expect(api.status.value).toBe("loading")

      await vi.advanceTimersByTimeAsync(15_000)
      expect(api.status.value).toBe("error")
      expect(api.error.value).toContain("did not start")
      wrapper.unmount()
    } finally {
      vi.useRealTimers()
    }
  })
})
