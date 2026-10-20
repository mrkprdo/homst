import { describe, it, expect } from "vitest"
import { mount } from "@vue/test-utils"
import EventChip from "@/components/ui/EventChip.vue"
import { DEFAULT_SAGE_HEX } from "@/__tests__/constants"

describe("EventChip", () => {
  it("renders the title", () => {
    const wrapper = mount(EventChip, {
      props: { title: "Team Standup" },
    })
    expect(wrapper.text()).toContain("Team Standup")
  })

  it("renders time when provided and not allDay", () => {
    const wrapper = mount(EventChip, {
      props: { title: "Dinner", time: "6:00 PM" },
    })
    expect(wrapper.text()).toContain("6:00 PM")
  })

  it("renders time in 12-hour format", () => {
    const wrapper = mount(EventChip, {
      props: { title: "Event", time: "2:30 PM" },
    })
    expect(wrapper.find(".event-chip__time").text()).toMatch(/\d{1,2}:\d{2}\s*(AM|PM)/i)
  })

  it("renders time in 24-hour format", () => {
    const wrapper = mount(EventChip, {
      props: { title: "Event", time: "14:30" },
    })
    expect(wrapper.find(".event-chip__time").text()).toMatch(/\d{1,2}:\d{2}/)
  })

  it("does not render time when allDay", () => {
    const wrapper = mount(EventChip, {
      props: { title: "Holiday", time: "12:00 AM", allDay: true },
    })
    expect(wrapper.find(".event-chip__time").exists()).toBe(false)
  })

  it("defaults to sage hex color when no color prop", () => {
    const wrapper = mount(EventChip, { props: { title: "Test" } })
    const style = wrapper.attributes("style") ?? ""
    expect(style).toContain(`--chip-color: ${DEFAULT_SAGE_HEX}`)
  })

  it("applies custom hex color via CSS custom property", () => {
    const wrapper = mount(EventChip, {
      props: { title: "Test", color: "#fcd0a1" },
    })
    const style = wrapper.attributes("style") ?? ""
    expect(style).toContain("--chip-color: #fcd0a1")
  })
})
