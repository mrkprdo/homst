import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { defineComponent, h, nextTick, ref, type Ref } from "vue"
import { mount } from "@vue/test-utils"
import { useCameraStream, STALL_TIMEOUT_MS } from "@/composables/useCameraStream"

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

/** Get the current hls.js instance and report a parsed manifest. */
function playingInstance(api: ReturnType<typeof useCameraStream>) {
  const instance = hls.instances.at(-1)!
  instance.handlers["manifest"]!("manifest", {})
  expect(api.status.value).toBe("playing")
  return instance
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
    vi.useRealTimers()
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

  it("prefers hls.js even when the browser claims native HLS", async () => {
    // Chromium can advertise native HLS and then re-fetch the playlist in a
    // zero-delay loop; hls.js keeps the reload on the playlist's cadence.
    vi.mocked(HTMLMediaElement.prototype.canPlayType).mockReturnValue("maybe")

    const path = ref("/both.m3u8")
    const { wrapper } = mountStream(path)
    await nextTick()

    expect(hls.instances).toHaveLength(1)
    expect(hls.instances[0].loaded).toBe("/both.m3u8")
    const video = wrapper.find("video").element as HTMLVideoElement
    expect(video.getAttribute("src")).toBeNull()
    wrapper.unmount()
  })

  it("plays native HLS and swallows a rejected play promise", async () => {
    // Native is the fallback only: no MSE, but HLS is supported (Safari, iOS).
    hls.FakeHls.supported = false
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

  it("uses hls.js and retries a transient network error", async () => {
    const path = ref("/live.m3u8")
    const { wrapper, api } = mountStream(path)
    await nextTick()

    expect(api.status.value).toBe("loading")
    const instance = hls.instances[0]
    expect(instance.config.lowLatencyMode).toBe(false)
    expect(instance.config.liveSyncDurationCount).toBe(3)
    // Drift is tolerated instead of forcing a seek to the live edge.
    expect(instance.config.liveMaxLatencyDurationCount).toBe(30)
    expect(instance.config.maxBufferLength).toBe(12)
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
    expect(instance.startLoads).toBe(2)

    instance.handlers["error"]!("error", { fatal: true, type: "network" })
    expect(api.status.value).toBe("error")
    expect(api.error.value).toBe("Could not reach the camera stream. Check the URL and credentials in Settings.")
    expect(instance.destroyed).toBe(true)

    wrapper.unmount()
  })

  it("ignores a segment that was pruned from the live window", async () => {
    const path = ref("/live.m3u8")
    const { wrapper, api } = mountStream(path)
    await nextTick()

    const instance = playingInstance(api)
    // A lagging client can ask for a segment the server already deleted. That is
    // not a dead stream: hls.js skips it and keeps playing.
    instance.handlers["error"]!("error", {
      fatal: true,
      type: "network",
      frag: { url: "/api/v1/camera/hls/token/seg_000001.ts" },
      response: { code: 404, text: "Camera segment not found." },
    })
    expect(api.status.value).toBe("playing")
    expect(instance.startLoads).toBe(0)
    expect(instance.destroyed).toBe(false)

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

  it("recovers a media error, then reports it", async () => {
    const path = ref("/live.m3u8")
    const { wrapper, api } = mountStream(path)
    await nextTick()

    const instance = hls.instances[0]
    instance.handlers["error"]!("error", { fatal: true, type: "media" })
    expect(instance.recoveries).toBe(1)
    expect(api.status.value).toBe("loading")

    instance.handlers["error"]!("error", { fatal: true, type: "media" })
    expect(instance.recoveries).toBe(2)
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
    const path = ref("/live.m3u8")
    const { wrapper, api } = mountStream(path)
    await nextTick()
    expect(api.status.value).toBe("loading")

    await vi.advanceTimersByTimeAsync(15_000)
    expect(api.status.value).toBe("error")
    expect(api.error.value).toContain("did not start")
    wrapper.unmount()
  })

  it("reconnects on its own after a fatal HTTP error", async () => {
    // The server deletes the playlist while ffmpeg restarts after a camera
    // hiccup. A kiosk must recover from that window without a human tap.
    vi.useFakeTimers()
    const path = ref("/live.m3u8")
    const { wrapper, api } = mountStream(path)
    await nextTick()

    const instance = playingInstance(api)
    instance.handlers["error"]!("error", {
      fatal: true,
      type: "network",
      response: { code: 502, text: "" },
    })
    expect(api.status.value).toBe("error")
    expect(instance.destroyed).toBe(true)

    const instancesBefore = hls.instances.length
    await vi.advanceTimersByTimeAsync(60_000)
    expect(hls.instances.length).toBe(instancesBefore + 1)
    expect(api.status.value).toBe("loading")

    playingInstance(api)
    wrapper.unmount()
  })

  /** Stub the compositor-frame signal on the video element. */
  function stubRenderFrames(el: HTMLVideoElement) {
    let frameCb: (() => void) | null = null
    el.requestVideoFrameCallback = ((cb: () => void) => {
      frameCb = cb
      return 1
    }) as typeof el.requestVideoFrameCallback
    return {
      /** Present one frame to the compositor. */
      render: () => frameCb?.(),
      get pending() {
        return frameCb !== null
      },
    }
  }

  it("rebuilds the pipeline when the picture freezes but the clock keeps advancing", async () => {
    // A stuck hardware decoder can leave timeupdate firing while the picture
    // is frozen. Only a full rebuild (fresh MediaSource + decoder) fixes that.
    vi.useFakeTimers()
    const path = ref("/live.m3u8")
    const { wrapper, api } = mountStream(path)
    await nextTick()
    const frames = stubRenderFrames(wrapper.find("video").element as HTMLVideoElement)

    const instance = playingInstance(api)
    expect(frames.pending).toBe(true)

    // The clock keeps ticking; no frame ever reaches the compositor.
    for (let step = 0; step < 5; step++) {
      await vi.advanceTimersByTimeAsync(4_000)
      await wrapper.find("video").trigger("timeupdate")
    }
    expect(instance.destroyed).toBe(true)
    expect(hls.instances).toHaveLength(2)
    expect(api.status.value).toBe("loading")

    playingInstance(api)
    frames.render()
    expect(api.status.value).toBe("playing")
    wrapper.unmount()
  })

  it("cancels and ignores frame callbacks from a torn-down pipeline", async () => {
    const path = ref("/live.m3u8")
    const { wrapper, api } = mountStream(path)
    await nextTick()
    const el = wrapper.find("video").element as HTMLVideoElement
    let frameCb: (() => void) | null = null
    const cancelled: number[] = []
    el.requestVideoFrameCallback = ((cb: () => void) => {
      frameCb = cb
      return 7
    }) as typeof el.requestVideoFrameCallback
    el.cancelVideoFrameCallback = ((handle: number) => {
      cancelled.push(handle)
    }) as typeof el.cancelVideoFrameCallback

    playingInstance(api)
    expect(frameCb).not.toBeNull()
    api.retry()
    await nextTick()
    expect(cancelled).toEqual([7])

    // A stale callback from the old pipeline must not report progress or
    // re-register itself on the new one.
    frameCb!()
    expect(api.status.value).toBe("loading")
    wrapper.unmount()
  })

  it("does not rebuild for a frozen render while the page is hidden", async () => {
    // Background tabs stop composing frames without anything being broken.
    vi.useFakeTimers()
    Object.defineProperty(document, "visibilityState", {
      value: "hidden",
      configurable: true,
    })
    try {
      const path = ref("/live.m3u8")
      const { wrapper, api } = mountStream(path)
      await nextTick()
      stubRenderFrames(wrapper.find("video").element as HTMLVideoElement)

      const instance = playingInstance(api)
      for (let step = 0; step < 5; step++) {
        await vi.advanceTimersByTimeAsync(4_000)
        await wrapper.find("video").trigger("timeupdate")
      }
      expect(api.status.value).toBe("playing")
      expect(instance.destroyed).toBe(false)
      wrapper.unmount()
    } finally {
      Reflect.deleteProperty(document, "visibilityState")
    }
  })

  it("treats presented frames as progress even without timeupdate", async () => {
    vi.useFakeTimers()
    const path = ref("/live.m3u8")
    const { wrapper, api } = mountStream(path)
    await nextTick()
    const frames = stubRenderFrames(wrapper.find("video").element as HTMLVideoElement)

    const instance = playingInstance(api)
    for (let step = 0; step < 6; step++) {
      await vi.advanceTimersByTimeAsync(4_000)
      frames.render()
    }
    expect(api.status.value).toBe("playing")
    expect(instance.destroyed).toBe(false)
    wrapper.unmount()
  })

  it("escalates a permanently frozen decoder to the slow reconnect cadence", async () => {
    vi.useFakeTimers()
    const path = ref("/live.m3u8")
    const { wrapper, api } = mountStream(path)
    await nextTick()
    stubRenderFrames(wrapper.find("video").element as HTMLVideoElement)

    playingInstance(api)
    // Every rebuild comes back playing (clock alive) but never renders again.
    for (let attempt = 0; attempt < 4; attempt++) {
      for (let step = 0; step < 5; step++) {
        await vi.advanceTimersByTimeAsync(4_000)
        await wrapper.find("video").trigger("timeupdate")
      }
      if (api.status.value === "loading") playingInstance(api)
    }
    expect(api.status.value).toBe("failed")
    expect(api.error.value).toBe("failed retrieving stream")
    // 1 initial pipeline + 3 rebuilds, then the slow-cadence reconnect.
    expect(hls.instances).toHaveLength(4)

    await vi.advanceTimersByTimeAsync(60_000)
    expect(hls.instances).toHaveLength(5)
    expect(api.status.value).toBe("loading")
    wrapper.unmount()
  })

  it("flags a stalled stream as retrieving and recovers when frames return", async () => {
    vi.useFakeTimers()
    const path = ref("/live.m3u8")
    const { wrapper, api } = mountStream(path)
    await nextTick()

    const instance = playingInstance(api)

    await vi.advanceTimersByTimeAsync(STALL_TIMEOUT_MS)
    expect(api.status.value).toBe("retrieving")
    expect(api.error.value).toBe("retrieving stream...")
    expect(instance.startLoads).toBe(1)

    await wrapper.find("video").trigger("timeupdate")
    expect(api.status.value).toBe("playing")
    expect(api.error.value).toBe("")

    wrapper.unmount()
  })

  it("does not treat buffered playback as stalled", async () => {
    vi.useFakeTimers()
    const path = ref("/live.m3u8")
    const { wrapper, api } = mountStream(path)
    await nextTick()

    playingInstance(api)

    // hls.js can stop downloading while its buffer is full. As long as the
    // video keeps advancing, the stream is healthy.
    for (let step = 0; step < 4; step++) {
      await vi.advanceTimersByTimeAsync(STALL_TIMEOUT_MS - 1_000)
      await wrapper.find("video").trigger("timeupdate")
    }
    expect(api.status.value).toBe("playing")

    wrapper.unmount()
  })

  it("gives up after three failed recoveries and reconnects every minute", async () => {
    vi.useFakeTimers()
    const path = ref("/live.m3u8")
    const { wrapper, api } = mountStream(path)
    await nextTick()

    playingInstance(api)

    for (let attempt = 0; attempt < 4; attempt++) {
      await vi.advanceTimersByTimeAsync(STALL_TIMEOUT_MS)
    }
    expect(api.status.value).toBe("failed")
    expect(api.error.value).toBe("failed retrieving stream")

    const instancesBefore = hls.instances.length
    await vi.advanceTimersByTimeAsync(60_000)
    expect(hls.instances.length).toBe(instancesBefore + 1)
    expect(api.status.value).toBe("loading")

    wrapper.unmount()
  })

  it("manual retry cancels the scheduled reconnect", async () => {
    vi.useFakeTimers()
    const path = ref("/live.m3u8")
    const { wrapper, api } = mountStream(path)
    await nextTick()

    playingInstance(api)
    for (let attempt = 0; attempt < 4; attempt++) {
      await vi.advanceTimersByTimeAsync(STALL_TIMEOUT_MS)
    }
    expect(api.status.value).toBe("failed")

    const instancesBefore = hls.instances.length
    api.retry()
    await nextTick()
    expect(hls.instances.length).toBe(instancesBefore + 1)
    expect(api.status.value).toBe("loading")

    wrapper.unmount()
  })

  it("reloads the video element when native HLS stalls", async () => {
    vi.useFakeTimers()
    hls.FakeHls.supported = false
    vi.mocked(HTMLMediaElement.prototype.canPlayType).mockReturnValue("maybe")
    const path = ref("/native.m3u8")
    const { wrapper, api } = mountStream(path)
    await nextTick()
    expect(api.status.value).toBe("playing")

    vi.mocked(HTMLMediaElement.prototype.load).mockClear()
    await vi.advanceTimersByTimeAsync(STALL_TIMEOUT_MS)
    expect(api.status.value).toBe("retrieving")
    expect(HTMLMediaElement.prototype.load).toHaveBeenCalled()

    await wrapper.find("video").trigger("timeupdate")
    expect(api.status.value).toBe("playing")

    wrapper.unmount()
  })
})
