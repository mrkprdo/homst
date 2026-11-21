import { afterEach, describe, expect, it, vi } from "vitest"
import { mount } from "@vue/test-utils"
import MobileQuickAdd from "@/components/mobile/MobileQuickAdd.vue"

const AiImportPanelStub = {
  name: "AiImportPanel",
  emits: ["done"],
  template: '<button class="ai-stub" @click="$emit(\'done\', 1)">AI stub</button>',
}

describe("MobileQuickAdd AI tab", () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it("shows the importer without the manual footer and closes after adding", async () => {
    vi.useFakeTimers()
    const wrapper = mount(MobileQuickAdd, {
      global: { stubs: { AiImportPanel: AiImportPanelStub } },
    })

    await wrapper.findAll("button").find(button => button.text() === "Import")!.trigger("click")
    expect(wrapper.find(".ai-stub").exists()).toBe(true)
    expect(wrapper.find(".mqa-footer").exists()).toBe(false)

    await wrapper.find(".ai-stub").trigger("click")
    expect(wrapper.find(".mqa-toast").text()).toContain("Event added")

    vi.advanceTimersByTime(800)
    expect(wrapper.emitted("close")).toHaveLength(1)
  })

  it("keeps the manual footer on the event and task tabs", async () => {
    const wrapper = mount(MobileQuickAdd, {
      global: { stubs: { AiImportPanel: AiImportPanelStub } },
    })
    expect(wrapper.find(".mqa-footer").exists()).toBe(true)
    await wrapper.findAll("button").find(button => button.text() === "Import")!.trigger("click")
    await wrapper.findAll("button").find(button => button.text() === "Event")!.trigger("click")
    expect(wrapper.find(".mqa-footer").exists()).toBe(true)
  })
})
