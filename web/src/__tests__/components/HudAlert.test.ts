import { describe, it, expect } from "vitest"
import { mount } from "@vue/test-utils"
import HudAlert from "@/components/shared/HudAlert.vue"
import { useNotifications } from "@/composables/useNotifications"

const global = { stubs: { teleport: true } }

describe("HudAlert", () => {
  it("renders nothing while the queue is empty", () => {
    const wrapper = mount(HudAlert, { global })
    expect(wrapper.find(".hud-card").exists()).toBe(false)
  })

  it("renders a card with a live minutes label", async () => {
    useNotifications().push({
      event_id: "ev-1", title: "Soccer practice",
      start_at: new Date(Date.now() + 30 * 60000).toISOString(), minutes_before: 30,
    })
    const wrapper = mount(HudAlert, { global })
    await wrapper.vm.$nextTick()
    expect(wrapper.find(".hud-title").text()).toBe("Soccer practice")
    expect(wrapper.find(".hud-when").text()).toContain("In 30 min")
  })

  it("dismiss button removes the card", async () => {
    useNotifications().push({ event_id: "ev-1", title: "Dentist", start_at: "2030-06-01T10:00:00Z" })
    const wrapper = mount(HudAlert, { global })
    await wrapper.vm.$nextTick()
    expect(wrapper.find(".hud-card").exists()).toBe(true)
    await wrapper.find(".hud-dismiss").trigger("click")
    await wrapper.vm.$nextTick()
    expect(wrapper.find(".hud-card").exists()).toBe(false)
  })

  it("shows an all-day label for all-day events", async () => {
    useNotifications().push({ event_id: "ev-2", title: "Holiday", start_at: new Date().toISOString(), all_day: true })
    const wrapper = mount(HudAlert, { global })
    await wrapper.vm.$nextTick()
    expect(wrapper.find(".hud-when").text()).toBe("All day today")
  })

  it("labels a reminder with no start time as starting soon", async () => {
    useNotifications().push({ event_id: "ev-3", title: "Mystery", start_at: null, minutes_before: null })
    const wrapper = mount(HudAlert, { global })
    await wrapper.vm.$nextTick()
    expect(wrapper.find(".hud-when").text()).toBe("starting soon")
  })

  it("labels a reminder scheduled for tomorrow", async () => {
    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)
    tomorrow.setHours(9, 0, 0, 0)
    useNotifications().push({ event_id: "ev-4", title: "Breakfast", start_at: tomorrow.toISOString() })
    const wrapper = mount(HudAlert, { global })
    await wrapper.vm.$nextTick()
    expect(wrapper.find(".hud-when").text()).toContain("tomorrow")
  })
})
