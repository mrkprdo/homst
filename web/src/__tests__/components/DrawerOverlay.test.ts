import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { nextTick } from "vue"
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
    vi.restoreAllMocks()
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

  async function mountOpen(slot = "") {
    const ui = useUi()
    ui.drawer.value = { type: "event-detail", id: "evt-1", date: null, time: null }
    ui.isDrawerOpen.value = false
    wrapper = mount(DrawerOverlay, { attachTo: document.body, slots: { default: slot } })
    await nextTick()
    ui.isDrawerOpen.value = true
    await nextTick()
    return ui
  }

  it("is exposed as a modal dialog with a type-specific label", async () => {
    await mountOpen()
    const drawer = document.querySelector(".drawer")!
    expect(drawer.getAttribute("role")).toBe("dialog")
    expect(drawer.getAttribute("aria-modal")).toBe("true")
    expect(drawer.getAttribute("aria-label")).toBe("Event details")
    expect(drawer.getAttribute("tabindex")).toBe("-1")
  })

  it("falls back to a generic dialog label for an unknown drawer type", async () => {
    const ui = useUi()
    ui.drawer.value = { type: "unknown" as unknown as DrawerType, id: null, date: null, time: null }
    ui.isDrawerOpen.value = true
    wrapper = mount(DrawerOverlay, { attachTo: document.body })
    await nextTick()
    expect(document.querySelector(".drawer")!.getAttribute("aria-label")).toBe("Details")
  })

  it("closes on Escape and returns focus to the opener", async () => {
    const opener = document.createElement("button")
    document.body.appendChild(opener)
    opener.focus()

    const ui = await mountOpen()
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
    await nextTick()

    expect(ui.isDrawerOpen.value).toBe(false)
    expect(document.activeElement).toBe(opener)
  })

  it("keeps Tab focus inside the drawer", async () => {
    // jsdom has no layout, so the visibility filter needs a hit rectangle.
    vi.spyOn(Element.prototype, "getClientRects").mockReturnValue(
      [{ width: 10, height: 10 }] as unknown as DOMRectList,
    )

    await mountOpen('<button class="first">One</button><button class="second">Two</button>')
    const close = document.querySelector<HTMLButtonElement>(".close-btn")!
    const last = document.querySelector<HTMLButtonElement>(".drawer-content .second")!

    last.focus()
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }))
    expect(document.activeElement).toBe(close)

    close.focus()
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true }))
    expect(document.activeElement).toBe(last)

    const outside = document.createElement("button")
    document.body.appendChild(outside)
    outside.focus()
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }))
    expect(document.activeElement).toBe(close)

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true }))
    expect(document.activeElement).toBe(close)
  })

  it("focuses the drawer shell when it has no focusable content", async () => {
    await mountOpen()
    const drawer = document.querySelector<HTMLElement>(".drawer")!
    document.querySelector(".close-btn")!.remove()

    drawer.focus()
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }))

    expect(document.activeElement).toBe(drawer)
  })

  it("ignores a keydown that arrives after the drawer starts closing", async () => {
    const ui = await mountOpen()
    // Flip the state and dispatch before the watcher can remove the listener.
    ui.isDrawerOpen.value = false
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
    await nextTick()
    expect(ui.isDrawerOpen.value).toBe(false)
  })
})
