import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { nextTick } from "vue"
import { mount } from "@vue/test-utils"
import { setCheapCompositor, setLowPower, setPerformanceMode } from "@/lib/motion"
import { useSettings } from "@/composables/useSettings"
import HomeView from "@/components/home/HomeView.vue"

async function settle() {
  for (let i = 0; i < 30; i += 1) await Promise.resolve()
  await nextTick()
  await Promise.resolve()
  await nextTick()
}

function stubImage(decode: () => Promise<void> = () => Promise.resolve()) {
  class FakeImage {
    src = ""
    naturalWidth = 1280
    naturalHeight = 720
    decode = decode
  }
  vi.stubGlobal("Image", FakeImage)
}

function stubCanvasCover(): ReturnType<typeof vi.fn> {
  const drawImage = vi.fn()
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation((() => ({
    filter: "none",
    drawImage,
  })) as any)
  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockImplementation((() =>
    "data:image/jpeg;base64,cover") as any)
  return drawImage
}

function seedPhotos(count = 1) {
  useSettings().photos.value = Array.from({ length: count }, (_, index) => ({
    id: `p${index + 1}`,
    url: `/p${index + 1}.jpg`,
    selected: true,
  }))
}

describe("HomeView photo backdrops", () => {
  beforeEach(() => {
    setLowPower(true)
    setPerformanceMode(false)
    setCheapCompositor(false)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    setCheapCompositor(false)
    setPerformanceMode(false)
    setLowPower(false)
  })

  it("pre-blurs the letterbox cover once instead of filtering per frame", async () => {
    stubImage()
    const drawImage = stubCanvasCover()
    seedPhotos()

    const wrapper = mount(HomeView)
    await settle()

    const backdrop = wrapper.find(".photos-backdrop")
    expect(backdrop.exists()).toBe(true)
    expect(backdrop.attributes("src")).toBe("data:image/jpeg;base64,cover")
    expect(backdrop.classes()).not.toContain("photos-backdrop--fallback")
    expect(drawImage).toHaveBeenCalledTimes(1)

    wrapper.unmount()
  })

  it("falls back to the CSS blur when the cover cannot be decoded", async () => {
    stubImage(() => Promise.reject(new Error("decode failed")))
    stubCanvasCover()
    seedPhotos()

    const wrapper = mount(HomeView)
    await settle()

    const backdrop = wrapper.find(".photos-backdrop")
    expect(backdrop.attributes("src")).toBe("/p1.jpg")
    expect(backdrop.classes()).toContain("photos-backdrop--fallback")

    wrapper.unmount()
  })

  it("keeps the blurred backdrop and dissolve on a software compositor", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(Math.floor(Date.now() / 15_000) * 15_000)
    setCheapCompositor(true)
    stubImage()
    const drawImage = stubCanvasCover()
    seedPhotos(2)

    const wrapper = mount(HomeView)
    await settle()

    const backdrop = wrapper.find(".photos-backdrop")
    expect(backdrop.exists()).toBe(true)
    expect(backdrop.attributes("src")).toBe("data:image/jpeg;base64,cover")
    expect(drawImage).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(5000)
    await settle()
    expect(wrapper.findAll(".photos-img")).toHaveLength(2)
    expect(wrapper.findAll(".photos-img")[1]!.classes()).toContain("photos-img--dissolve")

    wrapper.unmount()
  })

  it("drops the faded-out frame after the cross-dissolve", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(Math.floor(Date.now() / 15_000) * 15_000)
    stubImage()
    stubCanvasCover()
    seedPhotos(2)

    const wrapper = mount(HomeView)
    await settle()
    expect(wrapper.findAll(".photos-img")).toHaveLength(1)

    await vi.advanceTimersByTimeAsync(5000)
    await settle()
    expect(wrapper.findAll(".photos-img")).toHaveLength(2)

    await vi.advanceTimersByTimeAsync(2200)
    await settle()
    expect(wrapper.findAll(".photos-img")).toHaveLength(1)

    wrapper.unmount()
  })
})
