import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { mount, VueWrapper } from "@vue/test-utils"
import DrawerOverlay from "@/components/shared/DrawerOverlay.vue"
import { useUi, type DrawerType } from "@/composables/useUi"

let wrapper: VueWrapper | null = null

function openDrawer(type: DrawerType, id?: string) {
  const ui = useUi()
  ui.drawer.value = { type, id: id ?? null, date: null, time: null }
  ui.isDrawerOpen.value = true
}

describe("DrawerOverlay", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    wrapper = null
  })

  afterEach(() => {
    wrapper?.unmount()
    wrapper = null
    document.body.innerHTML = ""
    vi.useRealTimers()
  })

  it("does not render when drawer is closed", () => {
    wrapper = mount(DrawerOverlay, { attachTo: document.body })
    expect(document.querySelector(".backdrop")).toBeNull()
    expect(document.querySelector(".drawer")).toBeNull()
  })

  it("renders backdrop and drawer when open", async () => {
    openDrawer("event-detail", "evt-1")
    wrapper = mount(DrawerOverlay, { attachTo: document.body })
    await wrapper.vm.$nextTick()
    expect(document.querySelector(".backdrop")).not.toBeNull()
    expect(document.querySelector(".drawer")).not.toBeNull()
  })

  it("drawer shows correct header text for event-detail", async () => {
    openDrawer("event-detail")
    wrapper = mount(DrawerOverlay, { attachTo: document.body })
    await wrapper.vm.$nextTick()
    expect(document.querySelector(".drawer-header h3")!.textContent).toBe("Event")
  })

  it("drawer shows correct header for task-detail", async () => {
    openDrawer("task-detail")
    wrapper = mount(DrawerOverlay, { attachTo: document.body })
    await wrapper.vm.$nextTick()
    expect(document.querySelector(".drawer-header h3")!.textContent).toBe("Task")
  })

  it("drawer shows correct header for quick-add", async () => {
    openDrawer("quick-add")
    wrapper = mount(DrawerOverlay, { attachTo: document.body })
    await wrapper.vm.$nextTick()
    expect(document.querySelector(".drawer-header h3")!.textContent).toBe("Quick Add")
  })

  it("drawer shows correct header for confirm", async () => {
    openDrawer("confirm")
    wrapper = mount(DrawerOverlay, { attachTo: document.body })
    await wrapper.vm.$nextTick()
    expect(document.querySelector(".drawer-header h3")!.textContent).toBe("Confirm")
  })

  it("drawer shows brand header for member-detail", async () => {
    openDrawer("member-detail")
    wrapper = mount(DrawerOverlay, { attachTo: document.body })
    await wrapper.vm.$nextTick()
    expect(document.querySelector(".drawer-brand")).not.toBeNull()
    expect(document.querySelector(".drawer-wordmark")!.textContent).toBe("HOMST")
  })

  it("backdrop click closes drawer", async () => {
    openDrawer("event-detail")
    wrapper = mount(DrawerOverlay, { attachTo: document.body })
    await wrapper.vm.$nextTick()
    document.querySelector<HTMLElement>(".backdrop")!.click()
    const ui = useUi()
    expect(ui.isDrawerOpen.value).toBe(false)
  })

  it("close button closes drawer", async () => {
    openDrawer("event-detail")
    wrapper = mount(DrawerOverlay, { attachTo: document.body })
    await wrapper.vm.$nextTick()
    document.querySelector<HTMLElement>(".close-btn")!.click()
    const ui = useUi()
    expect(ui.isDrawerOpen.value).toBe(false)
  })

  it("close button has accessible label", async () => {
    openDrawer("event-detail")
    wrapper = mount(DrawerOverlay, { attachTo: document.body })
    await wrapper.vm.$nextTick()
    expect(document.querySelector(".close-btn")!.getAttribute("aria-label")).toBe("Close")
  })
})
