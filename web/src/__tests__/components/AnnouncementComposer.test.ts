import { describe, it, expect, vi } from "vitest"
import { mount, flushPromises } from "@vue/test-utils"
import AnnouncementComposer from "@/components/shared/AnnouncementComposer.vue"
import { useServerReachability } from "@/composables/useServerReachability"

describe("AnnouncementComposer", () => {
  it("explains an unreachable local server instead of showing a send error", async () => {
    const wrapper = mount(AnnouncementComposer)
    await flushPromises()

    await wrapper.find("#announcement-message").setValue("Dinner is ready")
    vi.mocked(fetch).mockRejectedValueOnce(new TypeError("Failed to fetch"))
    await wrapper.find("form").trigger("submit")
    await flushPromises()

    expect(wrapper.find(".ac-notice").text()).toContain("HOMST local server is out of reach")
    expect(wrapper.find(".ac-error").exists()).toBe(false)
    expect(useServerReachability().serverReachable.value).toBe(false)
  })
})
