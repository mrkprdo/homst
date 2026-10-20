import { describe, it, expect } from "vitest"
import { mount } from "@vue/test-utils"
import { nextTick } from "vue"
import AppNav from "@/components/shared/AppNav.vue"
import { useUi } from "@/composables/useUi"

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
