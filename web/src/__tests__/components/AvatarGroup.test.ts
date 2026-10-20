import { describe, it, expect } from "vitest"
import { mount } from "@vue/test-utils"
import UiAvatar from "@/components/ui/UiAvatar.vue"
import { COLORS, SIZES } from "@/__tests__/constants"

describe("UiAvatar", () => {
  it("renders slot content", () => {
    const wrapper = mount(UiAvatar, { slots: { default: "AB" } })
    expect(wrapper.text()).toContain("AB")
  })

  it("defaults to md size", () => {
    const wrapper = mount(UiAvatar)
    expect(wrapper.classes()).toContain("ui-avatar--md")
  })

  it("applies sm size", () => {
    const wrapper = mount(UiAvatar, { props: { size: "sm" } })
    expect(wrapper.classes()).toContain("ui-avatar--sm")
  })

  it("applies lg size", () => {
    const wrapper = mount(UiAvatar, { props: { size: "lg" } })
    expect(wrapper.classes()).toContain("ui-avatar--lg")
  })

  it("applies all sizes", () => {
    for (const size of SIZES) {
      const wrapper = mount(UiAvatar, { props: { size }, slots: { default: "AB" } })
      expect(wrapper.classes()).toContain(`ui-avatar--${size}`)
    }
  })

  it("defaults to sage color", () => {
    const wrapper = mount(UiAvatar)
    expect(wrapper.classes()).toContain("ui-avatar--sage")
  })

  it("applies explicit color", () => {
    for (const color of COLORS) {
      const wrapper = mount(UiAvatar, { props: { color } })
      expect(wrapper.classes()).toContain(`ui-avatar--${color}`)
    }
  })

  it("renders multiple avatars in a group layout", () => {
    const wrapper = mount({
      template: `<div class="avatar-group">${Array.from({ length: 3 }, (_, i) =>
        `<ui-avatar color="${COLORS[i]}" size="sm">U${i + 1}</ui-avatar>`
      ).join("")}</div>`,
      components: { UiAvatar },
    })
    expect(wrapper.findAllComponents({ name: "UiAvatar" })).toHaveLength(3)
  })
})
