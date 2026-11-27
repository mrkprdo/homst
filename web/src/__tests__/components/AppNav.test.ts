import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { mount } from "@vue/test-utils"
import { nextTick } from "vue"
import AppNav from "@/components/shared/AppNav.vue"
import { useUi } from "@/composables/useUi"
import { useSettings } from "@/composables/useSettings"

describe("AppNav", () => {
  it("renders 5 nav items (4 panels + profile)", () => {
    const wrapper = mount(AppNav)
    const items = wrapper.findAll(".nav-item")
    expect(items).toHaveLength(5)
  })

  it("home logo is active by default", () => {
    const wrapper = mount(AppNav)
    const logo = wrapper.find(".nav-logo")
    expect(logo.classes()).toContain("active")
  })

  it("clicking calendar sets active panel", async () => {
    const wrapper = mount(AppNav)
    const ui = useUi()
    const items = wrapper.findAll(".nav-item")
    await items[0]!.trigger("click")
    expect(ui.activePanel.value).toBe("calendar")
    expect(items[0]!.classes()).toContain("active")
  })

  it("clicking tasks sets active panel", async () => {
    const wrapper = mount(AppNav)
    const ui = useUi()
    await wrapper.findAll(".nav-item")[1]!.trigger("click")
    expect(ui.activePanel.value).toBe("tasks")
  })

  it("clicking announcements sets active panel", async () => {
    const wrapper = mount(AppNav)
    const ui = useUi()
    await wrapper.findAll(".nav-item")[2]!.trigger("click")
    expect(ui.activePanel.value).toBe("announcements")
  })

  it("clicking settings sets active panel", async () => {
    const wrapper = mount(AppNav)
    const ui = useUi()
    await wrapper.findAll(".nav-item")[3]!.trigger("click")
    expect(ui.activePanel.value).toBe("settings")
  })

  it("nav items have aria-labels", () => {
    const wrapper = mount(AppNav)
    const items = wrapper.findAll(".nav-item")
    expect(items[0]!.attributes("aria-label")).toBe("Calendar")
    expect(items[1]!.attributes("aria-label")).toBe("Tasks")
    expect(items[2]!.attributes("aria-label")).toBe("Announcements")
    expect(items[3]!.attributes("aria-label")).toBe("Settings")
    expect(items[4]!.attributes("aria-label")).toBe("Profile")
  })

  it("active state persists after re-render", async () => {
    const ui = useUi()
    ui.setPanel("tasks")
    const wrapper = mount(AppNav)
    await nextTick()
    expect(wrapper.findAll(".nav-item")[1]!.classes()).toContain("active")
  })

  it("profile button opens member-detail drawer", async () => {
    const wrapper = mount(AppNav)
    const ui = useUi()
    const profile = wrapper.find(".nav-item--profile")
    await profile.trigger("click")
    expect(ui.drawer.value.type).toBe("member-detail")
  })

  it("profile button shows active class when drawer is open", async () => {
    const wrapper = mount(AppNav)
    const ui = useUi()
    ui.openDrawer("member-detail")
    await nextTick()
    expect(wrapper.find(".nav-item--profile").classes()).toContain("active")
  })

  it("home logo activates home panel", async () => {
    const wrapper = mount(AppNav)
    const ui = useUi()
    const logo = wrapper.find(".nav-logo")
    await logo.trigger("click")
    expect(ui.activePanel.value).toBe("home")
    expect(logo.classes()).toContain("active")
  })
})

describe("AppNav auto-hide", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    useSettings().updateNavAutoHide(false)
  })

  const pointerMove = (clientX: number) =>
    window.dispatchEvent(new MouseEvent("pointermove", { clientX, bubbles: true }))

  const pointerEvent = (type: string, clientX: number, pointerType: string) => {
    const event = new MouseEvent(type, { clientX, bubbles: true })
    Object.defineProperty(event, "pointerType", { value: pointerType })
    return event
  }

  it("only applies the auto-hide classes when the setting is on", async () => {
    const wrapper = mount(AppNav)
    const settings = useSettings()
    expect(wrapper.find("nav").classes()).not.toContain("app-nav--autohide")

    settings.updateNavAutoHide(true)
    await nextTick()
    expect(wrapper.find("nav").classes()).toContain("app-nav--autohide")
    expect(wrapper.find("nav").classes()).not.toContain("app-nav--hidden")
  })

  it("hides once the pointer leaves the rail and reveals near the left edge", async () => {
    useSettings().updateNavAutoHide(true)
    const wrapper = mount(AppNav)
    await nextTick()

    pointerMove(600)
    vi.advanceTimersByTime(250)
    await nextTick()
    expect(wrapper.find("nav").classes()).toContain("app-nav--hidden")

    pointerMove(8)
    await nextTick()
    expect(wrapper.find("nav").classes()).not.toContain("app-nav--hidden")
  })

  it("starts the retreat as soon as the pointer leaves the rail", async () => {
    useSettings().updateNavAutoHide(true)
    const wrapper = mount(AppNav)
    await nextTick()

    pointerMove(30)
    vi.advanceTimersByTime(700)
    await nextTick()
    expect(wrapper.find("nav").classes()).not.toContain("app-nav--hidden")

    await wrapper.find("nav").trigger("pointerleave")
    vi.advanceTimersByTime(250)
    await nextTick()
    expect(wrapper.find("nav").classes()).toContain("app-nav--hidden")
  })

  it("hides even when the pointer stops just past the rail edge", async () => {
    useSettings().updateNavAutoHide(true)
    const wrapper = mount(AppNav)
    await nextTick()

    pointerMove(80)
    vi.advanceTimersByTime(250)
    await nextTick()
    expect(wrapper.find("nav").classes()).toContain("app-nav--hidden")
  })

  it("ignores the implicit pointerleave from a touch tap", async () => {
    useSettings().updateNavAutoHide(true)
    const wrapper = mount(AppNav)
    await nextTick()

    const leave = new Event("pointerleave")
    Object.defineProperty(leave, "pointerType", { value: "touch" })
    wrapper.find("nav").element.dispatchEvent(leave)
    vi.advanceTimersByTime(700)
    await nextTick()
    expect(wrapper.find("nav").classes()).not.toContain("app-nav--hidden")
  })

  it("a click on the hidden handle brings the rail back", async () => {
    useSettings().updateNavAutoHide(true)
    const wrapper = mount(AppNav)
    await nextTick()

    pointerMove(600)
    vi.advanceTimersByTime(250)
    await nextTick()
    expect(wrapper.find("nav").classes()).toContain("app-nav--hidden")

    window.dispatchEvent(pointerEvent("pointerdown", 8, "mouse"))
    await nextTick()
    expect(wrapper.find("nav").classes()).not.toContain("app-nav--hidden")
  })

  it("a touch on the edge reveals the rail and keeps it out long enough to pick", async () => {
    useSettings().updateNavAutoHide(true)
    const wrapper = mount(AppNav)
    await nextTick()

    pointerMove(600)
    vi.advanceTimersByTime(250)
    await nextTick()

    window.dispatchEvent(pointerEvent("pointerdown", 20, "touch"))
    await nextTick()
    expect(wrapper.find("nav").classes()).not.toContain("app-nav--hidden")

    vi.advanceTimersByTime(4500)
    await nextTick()
    expect(wrapper.find("nav").classes()).not.toContain("app-nav--hidden")

    vi.advanceTimersByTime(800)
    await nextTick()
    expect(wrapper.find("nav").classes()).toContain("app-nav--hidden")
  })

  it("a touch on an item waits before retiring the rail", async () => {
    useSettings().updateNavAutoHide(true)
    const wrapper = mount(AppNav, { attachTo: document.body })
    await nextTick()
    pointerMove(30)

    const item = wrapper.findAll(".nav-item")[0]!
    item.element.dispatchEvent(pointerEvent("pointerdown", 30, "touch"))

    vi.advanceTimersByTime(4500)
    await nextTick()
    expect(wrapper.find("nav").classes()).not.toContain("app-nav--hidden")

    vi.advanceTimersByTime(800)
    await nextTick()
    expect(wrapper.find("nav").classes()).toContain("app-nav--hidden")
    wrapper.unmount()
  })

  it("a mouse press on an item leaves the rail open until the pointer leaves", async () => {
    useSettings().updateNavAutoHide(true)
    const wrapper = mount(AppNav, { attachTo: document.body })
    await nextTick()
    pointerMove(30)

    const item = wrapper.findAll(".nav-item")[0]!
    item.element.dispatchEvent(pointerEvent("pointerdown", 30, "mouse"))
    vi.advanceTimersByTime(6000)
    await nextTick()
    expect(wrapper.find("nav").classes()).not.toContain("app-nav--hidden")
    wrapper.unmount()
  })

  it("a press outside the rail retires it", async () => {
    useSettings().updateNavAutoHide(true)
    const wrapper = mount(AppNav)
    await nextTick()
    pointerMove(30)

    document.body.dispatchEvent(pointerEvent("pointerdown", 400, "mouse"))
    vi.advanceTimersByTime(250)
    await nextTick()
    expect(wrapper.find("nav").classes()).toContain("app-nav--hidden")
  })

  it("leaving keyboard focus retires the rail", async () => {
    useSettings().updateNavAutoHide(true)
    const wrapper = mount(AppNav)
    await nextTick()
    pointerMove(30)

    wrapper.find("nav").element.dispatchEvent(
      new FocusEvent("focusout", { relatedTarget: document.body, bubbles: true }),
    )
    vi.advanceTimersByTime(250)
    await nextTick()
    expect(wrapper.find("nav").classes()).toContain("app-nav--hidden")
  })

  it("moving focus inside the rail does not retire it", async () => {
    useSettings().updateNavAutoHide(true)
    const wrapper = mount(AppNav)
    await nextTick()
    pointerMove(30)

    const nav = wrapper.find("nav")
    await nav.trigger("focusin")
    nav.element.dispatchEvent(
      new FocusEvent("focusout", {
        relatedTarget: wrapper.findAll(".nav-item")[0]!.element,
        bubbles: true,
      }),
    )
    vi.advanceTimersByTime(250)
    await nextTick()
    expect(nav.classes()).not.toContain("app-nav--hidden")
  })

  it("stays put while the pointer is on the rail", async () => {
    useSettings().updateNavAutoHide(true)
    const wrapper = mount(AppNav)
    await nextTick()

    pointerMove(600)
    pointerMove(30)
    vi.advanceTimersByTime(700)
    await nextTick()
    expect(wrapper.find("nav").classes()).not.toContain("app-nav--hidden")
  })

  it("reveals when keyboard focus reaches the rail", async () => {
    useSettings().updateNavAutoHide(true)
    const wrapper = mount(AppNav)
    await nextTick()

    pointerMove(600)
    vi.advanceTimersByTime(700)
    await nextTick()
    expect(wrapper.find("nav").classes()).toContain("app-nav--hidden")

    await wrapper.find("nav").trigger("focusin")
    expect(wrapper.find("nav").classes()).not.toContain("app-nav--hidden")
  })

  it("leaves the rail out while it holds keyboard focus", async () => {
    useSettings().updateNavAutoHide(true)
    const wrapper = mount(AppNav)
    await nextTick()

    const nav = wrapper.find("nav")
    await nav.trigger("focusin")
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab" }))
    pointerMove(600)
    vi.advanceTimersByTime(700)
    await nextTick()
    expect(nav.classes()).not.toContain("app-nav--hidden")
  })
})
