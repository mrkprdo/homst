import { describe, it, expect, afterEach } from "vitest"
import { mount } from "@vue/test-utils"
import UiButton from "@/components/ui/UiButton.vue"
import EventChip from "@/components/ui/EventChip.vue"
import { setLowPower } from "@/lib/motion"

/**
 * In low-power mode `animate()` applies the final state synchronously, which
 * lets us assert that the pointer handlers really executed.
 */
function dispatchPointer(el: Element, type: string) {
  el.dispatchEvent(new MouseEvent(type, { bubbles: true }))
}

describe("UiButton pointer feedback", () => {
  afterEach(() => setLowPower(false))

  it("animates on pointerdown, pointerup and pointerleave", () => {
    setLowPower(true)
    const wrapper = mount(UiButton, { slots: { default: "Go" } })
    const el = wrapper.element as HTMLElement

    dispatchPointer(el, "pointerdown")
    expect(el.style.transform).toContain("scaleX(1.06)")

    dispatchPointer(el, "pointerup")
    expect(el.style.transform).toContain("translateY(0px)")

    dispatchPointer(el, "pointerleave")
    expect(el.style.transform).toContain("translateY(0px)")
  })

  it("ignores pointerdown while disabled", () => {
    setLowPower(true)
    const wrapper = mount(UiButton, { props: { disabled: true } })
    const el = wrapper.element as HTMLElement

    dispatchPointer(el, "pointerdown")
    expect(el.style.transform).toBe("")
    expect(wrapper.attributes("disabled")).toBeDefined()
  })

  it("honours variant, size and type props", () => {
    const wrapper = mount(UiButton, { props: { variant: "ghost", size: "sm", type: "submit" } })
    expect(wrapper.classes()).toContain("ui-btn--ghost")
    expect(wrapper.classes()).toContain("ui-btn--sm")
    expect(wrapper.attributes("type")).toBe("submit")
  })
})

describe("EventChip pointer feedback", () => {
  afterEach(() => setLowPower(false))

  it("animates on press and emits click", () => {
    setLowPower(true)
    const wrapper = mount(EventChip, { props: { title: "Dinner" } })
    const el = wrapper.element as HTMLElement

    dispatchPointer(el, "pointerdown")
    expect(el.style.transform).toContain("scale(0.93)")

    dispatchPointer(el, "pointerup")
    expect(el.style.transform).toContain("scale(1)")

    dispatchPointer(el, "pointerleave")
    expect(el.style.transform).toContain("scale(1)")

    el.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    expect(wrapper.emitted("click")).toHaveLength(1)

    el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
    expect(wrapper.emitted("click")).toHaveLength(2)
  })

  it("renders the time only for timed events", () => {
    const timed = mount(EventChip, { props: { title: "Lunch", time: "12pm" } })
    expect(timed.find(".event-chip__time").text()).toBe("12pm")

    const allDay = mount(EventChip, { props: { title: "Holiday", time: "12pm", allDay: true } })
    expect(allDay.find(".event-chip__time").exists()).toBe(false)
  })
})
