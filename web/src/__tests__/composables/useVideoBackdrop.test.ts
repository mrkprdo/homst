import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { defineComponent, h, nextTick, ref, type Ref } from "vue"
import { mount } from "@vue/test-utils"
import { useVideoBackdrop, BACKDROP_MAX_DIMENSION } from "@/composables/useVideoBackdrop"

const drawImage = vi.fn()
const context = { drawImage }

function fakeVideo(width = 640, height = 480, readyState = 2) {
  return { videoWidth: width, videoHeight: height, readyState } as unknown as HTMLVideoElement
}

function fakeCanvas(getContext: () => unknown = () => context) {
  return { width: 0, height: 0, getContext } as unknown as HTMLCanvasElement
}

function mountBackdrop(activeValue = true) {
  const active = ref(activeValue)
  let video!: Ref<HTMLVideoElement | null>
  let api!: ReturnType<typeof useVideoBackdrop>
  const Comp = defineComponent({
    setup() {
      video = ref<HTMLVideoElement | null>(null)
      api = useVideoBackdrop(video, active, 250)
      return () => h("div")
    },
  })
  const wrapper = mount(Comp)
  return { wrapper, active, video, api }
}

describe("useVideoBackdrop", () => {
  beforeEach(() => {
    drawImage.mockClear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
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
})
