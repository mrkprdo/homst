import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { nextTick } from "vue"
import { mount, flushPromises } from "@vue/test-utils"
import { setLowPower } from "@/lib/motion"
import HomeView from "@/components/home/HomeView.vue"

type Wrapper = ReturnType<typeof mount>

let wrapper: Wrapper | null = null

beforeEach(() => {
  setLowPower(true)
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  document.querySelectorAll(".card-blowup").forEach(el => el.remove())
  document.body.innerHTML = ""
})

async function mountHome() {
  vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }))
  wrapper = mount(HomeView, { attachTo: document.body })
  await flushPromises()
  await nextTick()
  return wrapper
}

function nextFrame() {
  return new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
}

async function settleClose() {
  await nextFrame()
  await nextFrame()
  await nextTick()
  await flushPromises()
}

describe("card blow-up", () => {
  it("lifts a double-clicked card into the overlay and puts it back on close", async () => {
    const wrapper = await mountHome()
    const canvas = wrapper.find(".widget-canvas").element
    const card = wrapper.find(".home-block").element as HTMLElement

    await wrapper.find(".home-block").trigger("dblclick")
    await flushPromises()
    await nextTick()

    const layer = document.querySelector(".card-blowup")
    expect(layer).not.toBeNull()
    expect(layer!.getAttribute("aria-label")).toContain("card expanded")

    const stage = document.querySelector(".card-blowup__stage")!
    expect(stage.contains(card)).toBe(true)
    expect(canvas.contains(card)).toBe(false)

    const closeBtn = document.querySelector(".card-blowup__close") as HTMLElement
    expect(document.activeElement).toBe(closeBtn)

    closeBtn.click()
    closeBtn.click()

    await settleClose()

    expect(document.querySelector(".card-blowup")).toBeNull()
    expect(canvas.contains(card)).toBe(true)

    wrapper.unmount()
  })

  it("ignores double-clicks while editing or on interactive controls", async () => {
    const wrapper = await mountHome()

    await wrapper.find(".lock-toggle").trigger("click")
    await wrapper.find(".home-block").trigger("dblclick")
    await flushPromises()
    expect(document.querySelector(".card-blowup")).toBeNull()

    await wrapper.find(".lock-toggle").trigger("click")

    await wrapper.find('[aria-label="Next day"]').trigger("dblclick")
    await flushPromises()
    expect(document.querySelector(".card-blowup")).toBeNull()

    await wrapper.find(".widget-canvas").trigger("dblclick")
    await flushPromises()
    expect(document.querySelector(".card-blowup")).toBeNull()

    wrapper.unmount()
  })

  it("closes with Escape and keeps Tab inside the expanded card", async () => {
    const wrapper = await mountHome()
    await wrapper.find(".mini-cal-weekdays").trigger("dblclick")
    await flushPromises()
    await nextTick()

    const closeBtn = document.querySelector(".card-blowup__close") as HTMLElement
    const stage = document.querySelector(".card-blowup__stage")!
    expect(document.activeElement).toBe(closeBtn)

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true }))
    expect(stage.contains(document.activeElement)).toBe(true)

    const items = stage.querySelectorAll<HTMLElement>(
      "a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])",
    )
    items[items.length - 1]!.focus()
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab" }))
    expect(document.activeElement).toBe(closeBtn)

    const outside = document.createElement("button")
    document.body.appendChild(outside)
    outside.focus()
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab" }))
    expect(document.activeElement).toBe(closeBtn)

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))
    await settleClose()
    expect(document.querySelector(".card-blowup")).toBeNull()

    wrapper.unmount()
  })

  it("dismisses the blow-up when the backdrop is clicked", async () => {
    const wrapper = await mountHome()
    await wrapper.find(".home-block").trigger("dblclick")
    await flushPromises()
    await nextTick()

    ;(document.querySelector(".card-blowup__backdrop") as HTMLElement).click()
    await settleClose()

    expect(document.querySelector(".card-blowup")).toBeNull()
    wrapper.unmount()
  })
})
