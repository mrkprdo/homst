import { describe, it, expect } from "vitest"
import { mount } from "@vue/test-utils"
import OfflineNotifications from "@/components/shared/OfflineNotifications.vue"
import type { StoredPush } from "@/lib/pushStore"

const items: StoredPush[] = [
  {
    id: "push-2",
    title: "Announcement from Mark",
    body: "Dinner is ready",
    url: "/?announcement=ann-2&push=push-2",
    received_at: 1_767_225_900_000,
  },
  {
    id: "push-1",
    title: "Soccer practice",
    body: "Starts in 30 minutes",
    url: "/?event=ev-1&event_start=10&push=push-1",
    received_at: 1_767_225_600_000,
  },
]

describe("OfflineNotifications", () => {
  it("shows the selected push and lets the user read another one", async () => {
    const wrapper = mount(OfflineNotifications, {
      props: { items, selected: items[0]! },
    })

    expect(wrapper.find(".offline-push__title").text()).toBe("Announcement from Mark")
    expect(wrapper.find(".offline-push__body").text()).toBe("Dinner is ready")
    expect(wrapper.find(".offline-push__recent-item").text()).toContain("Soccer practice")

    await wrapper.find(".offline-push__recent-item").trigger("click")
    expect(wrapper.find(".offline-push__title").text()).toBe("Soccer practice")
    expect(wrapper.find(".offline-push__body").text()).toBe("Starts in 30 minutes")
  })

  it("emits close from the close button and backdrop", async () => {
    const wrapper = mount(OfflineNotifications, {
      props: { items, selected: items[0]! },
    })

    await wrapper.find(".offline-push__done").trigger("click")
    await wrapper.find(".offline-push").trigger("click")
    expect(wrapper.emitted("close")).toHaveLength(2)
  })

  it("follows the selected prop and closes from the header button", async () => {
    const wrapper = mount(OfflineNotifications, {
      props: { items, selected: null },
    })
    expect(wrapper.find(".offline-push__title").text()).toBe("Announcement from Mark")

    await wrapper.setProps({ selected: items[1]! })
    expect(wrapper.find(".offline-push__title").text()).toBe("Soccer practice")

    await wrapper.find(".offline-push__close").trigger("click")
    expect(wrapper.emitted("close")).toHaveLength(1)
  })
})
