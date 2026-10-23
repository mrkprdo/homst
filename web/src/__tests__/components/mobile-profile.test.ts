import { describe, it, expect, vi } from "vitest"
import { mount, flushPromises } from "@vue/test-utils"
import { nextTick } from "vue"
import MobileAnnouncements from "@/components/mobile/MobileAnnouncements.vue"
import MobileProfile from "@/components/mobile/MobileProfile.vue"
import {
  markServerReachable,
  markServerUnreachable,
} from "@/composables/useServerReachability"

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })

describe("MobileAnnouncements", () => {
  it("closes from the button and the backdrop", async () => {
    const wrapper = mount(MobileAnnouncements, {
      global: { stubs: { AnnouncementComposer: true, AnnouncementLiveList: true, PhX: true } },
    })
    await flushPromises()
    await wrapper.find(".ma-close").trigger("click")
    await wrapper.find(".mobile-announcements").trigger("click")
    expect(wrapper.emitted("close")).toHaveLength(2)
  })
})

describe("MobileProfile", () => {
  it("clears the unreachable notice when the server comes back", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(json([]))
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
    const wrapper = mount(MobileProfile, { global: { stubs: { teleport: true } } })
    await flushPromises()

    await wrapper.find(".mp-test-btn").trigger("click")
    await flushPromises()
    expect(wrapper.find(".mp-notice").exists()).toBe(true)

    markServerReachable()
    await nextTick()
    await flushPromises()
    expect(wrapper.find(".mp-notice").exists()).toBe(false)
  })

  it("toggles this device's push subscription", async () => {
    const wrapper = mount(MobileProfile, { global: { stubs: { teleport: true } } })
    await flushPromises()
    const toggle = wrapper.findComponent({ name: "UiToggle" })
    toggle.vm.$emit("update:modelValue", true)
    await flushPromises()
    toggle.vm.$emit("update:modelValue", false)
    await flushPromises()
    expect(wrapper.exists()).toBe(true)
  })

  it("shows a generic test failure for an HTTP error", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(json([]))
      .mockResolvedValueOnce(json({ detail: "nope" }, 500))
    const wrapper = mount(MobileProfile, { global: { stubs: { teleport: true } } })
    await flushPromises()
    await wrapper.find(".mp-test-btn").trigger("click")
    await flushPromises()
    expect(wrapper.find(".mp-test-result").text()).toContain("could not send the test")
  })

  it("accepts a non-Error failure from the test endpoint", async () => {
    const notifications = await import("@/api/notifications")
    vi.spyOn(notifications.notificationsApi, "sendTest").mockRejectedValueOnce("nope")
    const wrapper = mount(MobileProfile, { global: { stubs: { teleport: true } } })
    await flushPromises()
    await wrapper.find(".mp-test-btn").trigger("click")
    await flushPromises()
    expect(wrapper.find(".mp-test-result").text()).toContain("could not send the test")
  })

  it("marks the server unreachable before retrying", async () => {
    const wrapper = mount(MobileProfile, { global: { stubs: { teleport: true } } })
    await flushPromises()
    markServerUnreachable()
    await nextTick()
    expect(wrapper.find(".mp-notice").exists()).toBe(true)
  })
})
