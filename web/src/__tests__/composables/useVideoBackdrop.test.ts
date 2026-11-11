import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { defineComponent, h, nextTick, ref, type Ref } from "vue"
import { mount } from "@vue/test-utils"
import { useVideoBackdrop, BACKDROP_MAX_DIMENSION, LOW_POWER_BACKDROP_INTERVAL_MS } from "@/composables/useVideoBackdrop"
import { setLowPower, setPerformanceMode } from "@/lib/motion"

const drawImage = vi.fn()
const context = { drawImage }

function fakeVideo(width = 640, height = 480, readyState = 2) {
  return { videoWidth: width, videoHeight: height, readyState } as unknown as HTMLVideoElement
}

function fakeCanvas(getContext: () => unknown = () => context) {
  return { width: 0, height: 0, getContext } as unknown as HTMLCanvasElement
}

function mountBackdrop(activeValue = true, rotationValue = 0) {
  const active = ref(activeValue)
  const rotation = ref(rotationValue)
  let video!: Ref<HTMLVideoElement | null>
  let api!: ReturnType<typeof useVideoBackdrop>
  const Comp = defineComponent({
    setup() {
      video = ref<HTMLVideoElement | null>(null)
      api = useVideoBackdrop(video, active, 250, rotation)
      return () => h("div")
    },
  })
  const wrapper = mount(Comp)
  return { wrapper, active, rotation, video, api }
}

describe("useVideoBackdrop", () => {
  beforeEach(() => {
    drawImage.mockClear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
    setLowPower(false)
    setPerformanceMode(false)
  })

  it("draws a scaled copy of the playing frame", async () => {
    const { wrapper, video, api } = mountBackdrop()
    video.value = fakeVideo(1920, 1080)
    api.canvas.value = fakeCanvas()
    await nextTick()

    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, BACKDROP_MAX_DIMENSION, 180)
    expect(api.canvas.value!.width).toBe(BACKDROP_MAX_DIMENSION)
    expect(api.canvas.value!.height).toBe(180)
    wrapper.unmount()
  })

  it("rotates the snapshot with the camera so the backdrop matches the frame", async () => {
    const rotatedContext = {
      drawImage,
      save: vi.fn(),
      translate: vi.fn(),
      rotate: vi.fn(),
      restore: vi.fn(),
    }
    const { wrapper, video, api } = mountBackdrop(true, 90)
    video.value = fakeVideo(1920, 1080)
    api.canvas.value = fakeCanvas(() => rotatedContext)
    await nextTick()

    // A quarter turn swaps the backing canvas axes.
    expect(api.canvas.value!.width).toBe(180)
    expect(api.canvas.value!.height).toBe(BACKDROP_MAX_DIMENSION)
    expect(rotatedContext.rotate).toHaveBeenCalledWith(Math.PI / 2)
    expect(drawImage).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })

  it("does not draw when inactive, missing, or unready", async () => {
    const { wrapper, active, video, api } = mountBackdrop(false)
    video.value = fakeVideo()
    api.canvas.value = fakeCanvas()
    await nextTick()
    expect(drawImage).not.toHaveBeenCalled()

    active.value = true
    await nextTick()
    expect(drawImage).toHaveBeenCalledTimes(1)

    drawImage.mockClear()
    video.value = fakeVideo(0, 0, 0)
    await nextTick()
    expect(drawImage).not.toHaveBeenCalled()

    api.canvas.value = null
    video.value = fakeVideo()
    await nextTick()
    expect(drawImage).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it("skips drawing when the canvas has no 2d context", async () => {
    const { wrapper, video, api } = mountBackdrop()
    video.value = fakeVideo()
    api.canvas.value = fakeCanvas(() => null)
    await nextTick()
    expect(drawImage).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it("refreshes on an interval and stops on unmount", async () => {
    vi.useFakeTimers()
    const { wrapper, video, api } = mountBackdrop()
    video.value = fakeVideo()
    api.canvas.value = fakeCanvas()
    await nextTick()
    expect(drawImage).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(250)
    expect(drawImage).toHaveBeenCalledTimes(2)

    wrapper.unmount()
    await vi.advanceTimersByTimeAsync(250)
    expect(drawImage).toHaveBeenCalledTimes(2)
  })

  it("captures one frame then refreshes slowly on constrained devices", async () => {
    vi.useFakeTimers()
    setPerformanceMode(true)
    const { wrapper, video, api } = mountBackdrop()
    video.value = fakeVideo()
    api.canvas.value = fakeCanvas()
    await nextTick()

    expect(drawImage).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(LOW_POWER_BACKDROP_INTERVAL_MS - 1)
    expect(drawImage).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(1)
    expect(drawImage).toHaveBeenCalledTimes(2)

    wrapper.unmount()
  })

  it("keeps the slow cadence when the user re-enables animations", async () => {
    vi.useFakeTimers()
    setPerformanceMode(true)
    // The animation toggle is a taste setting; a Pi that opts into motion must
    // still not copy video frames into the canvas every 250ms while decoding.
    setLowPower(false)
    const { wrapper, video, api } = mountBackdrop()
    video.value = fakeVideo()
    api.canvas.value = fakeCanvas()
    await nextTick()

    expect(drawImage).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(250)
    expect(drawImage).toHaveBeenCalledTimes(1)

    wrapper.unmount()
  })

  it("waits for the first frame before using the slow cadence", async () => {
    vi.useFakeTimers()
    setPerformanceMode(true)
    const { wrapper, video, api } = mountBackdrop()
    const el = { videoWidth: 0, videoHeight: 0, readyState: 0 }
    video.value = el as unknown as HTMLVideoElement
    api.canvas.value = fakeCanvas()
    await nextTick()
    expect(drawImage).not.toHaveBeenCalled()

    el.videoWidth = 640
    el.videoHeight = 480
    el.readyState = 2
    await vi.advanceTimersByTimeAsync(500)
    expect(drawImage).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(LOW_POWER_BACKDROP_INTERVAL_MS)
    expect(drawImage).toHaveBeenCalledTimes(2)

    wrapper.unmount()
  })
})
