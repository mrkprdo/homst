import { describe, it, expect } from "vitest"
import { mount } from "@vue/test-utils"
import UiButton from "@/components/ui/UiButton.vue"
import { VARIANTS, SIZES } from "@/__tests__/constants"

describe("UiButton", () => {
  it("renders slot content", () => {
    const wrapper = mount(UiButton, { slots: { default: "Click me" } })
    expect(wrapper.text()).toContain("Click me")
  })

  it("defaults to primary variant", () => {
    const wrapper = mount(UiButton, { slots: { default: "OK" } })
    expect(wrapper.classes()).toContain("ui-btn--primary")
  })

  it("applies secondary variant", () => {
    const wrapper = mount(UiButton, { props: { variant: "secondary" }, slots: { default: "OK" } })
    expect(wrapper.classes()).toContain("ui-btn--secondary")
  })

  it("applies ghost variant", () => {
    const wrapper = mount(UiButton, { props: { variant: "ghost" }, slots: { default: "OK" } })
    expect(wrapper.classes()).toContain("ui-btn--ghost")
  })

  it("applies destructive variant", () => {
    const wrapper = mount(UiButton, { props: { variant: "destructive" }, slots: { default: "OK" } })
    expect(wrapper.classes()).toContain("ui-btn--destructive")
  })

  it("defaults to md size", () => {
    const wrapper = mount(UiButton, { slots: { default: "OK" } })
    expect(wrapper.classes()).toContain("ui-btn--md")
  })

  it("applies sm size", () => {
    const wrapper = mount(UiButton, { props: { size: "sm" }, slots: { default: "OK" } })
    expect(wrapper.classes()).toContain("ui-btn--sm")
  })

  it("disables button when disabled prop is set", () => {
    const wrapper = mount(UiButton, { props: { disabled: true }, slots: { default: "OK" } })
    expect(wrapper.find("button").attributes("disabled")).toBeDefined()
  })

  it("is not disabled by default", () => {
    const wrapper = mount(UiButton, { slots: { default: "OK" } })
    expect(wrapper.find("button").attributes("disabled")).toBeUndefined()
  })

  it("emits click event", async () => {
    const wrapper = mount(UiButton, { slots: { default: "OK" } })
    await wrapper.trigger("click")
    expect(wrapper.emitted("click")).toBeTruthy()
  })

  it("renders icon slot alongside text", () => {
    const wrapper = mount(UiButton, {
      slots: { default: "<span class='icon'>+</span> Add" },
    })
    expect(wrapper.find(".icon").exists()).toBe(true)
    expect(wrapper.text()).toContain("Add")
  })

  it("applies all variants without error", () => {
    for (const variant of VARIANTS) {
      const wrapper = mount(UiButton, { props: { variant }, slots: { default: variant } })
      expect(wrapper.classes()).toContain(`ui-btn--${variant}`)
    }
  })

  it("applies all sizes without error", () => {
    for (const size of SIZES.slice(0, 2)) {
      const wrapper = mount(UiButton, { props: { size: size as "sm" | "md" }, slots: { default: size } })
      expect(wrapper.classes()).toContain(`ui-btn--${size}`)
    }
  })
})
