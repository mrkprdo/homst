import { afterEach, describe, expect, it, vi } from "vitest"
import { nextTick } from "vue"
import { mount } from "@vue/test-utils"
import MobileQuickAdd from "@/components/mobile/MobileQuickAdd.vue"

const AiImportPanelStub = {
  name: "AiImportPanel",
  emits: ["done", "manual"],
  template: `
    <div>
      <button class="ai-stub" @click="$emit('done', 1)">AI stub</button>
      <button class="ai-manual-stub" @click="$emit('manual')">Add manually</button>
    </div>
  `,
}

describe("MobileQuickAdd Smart tab", () => {
  afterEach(() => {
    vi.useRealTimers()
    Reflect.deleteProperty(window, "visualViewport")
  })

  it("starts on Smart and shows the tabs in Smart, Event, Task order", async () => {
    const wrapper = mount(MobileQuickAdd, {
      global: { stubs: { AiImportPanel: AiImportPanelStub } },
    })

    expect(wrapper.findAll(".mqa-tab").map(tab => tab.text())).toEqual([
      "Smart",
      "Event",
      "Task",
    ])
    expect(wrapper.find(".mqa-tab.active").text()).toBe("Smart")
    expect(wrapper.find(".ai-stub").exists()).toBe(true)
    expect(wrapper.find(".mqa-footer").exists()).toBe(false)
  })

  it("closes after Smart import adds events", async () => {
    vi.useFakeTimers()
    const wrapper = mount(MobileQuickAdd, {
      global: { stubs: { AiImportPanel: AiImportPanelStub } },
    })

    expect(wrapper.find(".ai-stub").exists()).toBe(true)
    expect(wrapper.find(".mqa-footer").exists()).toBe(false)

    await wrapper.find(".ai-stub").trigger("click")
    expect(wrapper.find(".mqa-toast").text()).toContain("Event added")

    vi.advanceTimersByTime(800)
    expect(wrapper.emitted("close")).toHaveLength(1)
  })

  it("shows a focused Smart sheet and an updated toast for a resumed event", async () => {
    vi.useFakeTimers()
    const wrapper = mount(MobileQuickAdd, {
      props: {
        focusEventId: "ev-1",
        conversationId: "conv-1",
        focusEventTitle: "Dentist",
        focusSourceMessage: "Dentist Friday at 3",
      },
      global: { stubs: { AiImportPanel: AiImportPanelStub } },
    })

    expect(wrapper.findAll(".mqa-tab")).toHaveLength(0)
    expect(wrapper.find(".mqa-title").text()).toBe("Smart import")
    expect(wrapper.find(".ai-stub").exists()).toBe(true)

    await wrapper.find(".ai-stub").trigger("click")
    expect(wrapper.find(".mqa-toast").text()).toContain("Event updated")

    vi.advanceTimersByTime(800)
    expect(wrapper.emitted("close")).toHaveLength(1)
  })

  it("keeps the manual footer on the event and task tabs", async () => {
    const wrapper = mount(MobileQuickAdd, {
      global: { stubs: { AiImportPanel: AiImportPanelStub } },
    })
    const button = (label: string) =>
      wrapper.findAll("button").find(item => item.text() === label)!

    expect(wrapper.find(".mqa-footer").exists()).toBe(false)
    await button("Event").trigger("click")
    expect(wrapper.find(".mqa-footer").exists()).toBe(true)
    await button("Task").trigger("click")
    expect(wrapper.find(".mqa-footer").exists()).toBe(true)
    await button("Smart").trigger("click")
    expect(wrapper.find(".mqa-footer").exists()).toBe(false)
  })

  it("switches to the event form when the importer asks for manual entry", async () => {
    const wrapper = mount(MobileQuickAdd, {
      global: { stubs: { AiImportPanel: AiImportPanelStub } },
    })

    expect(wrapper.find(".ai-stub").exists()).toBe(true)
    await wrapper.find(".ai-manual-stub").trigger("click")

    expect(wrapper.find(".mqa-footer").exists()).toBe(true)
    expect(wrapper.find("input[placeholder='Event title']").exists()).toBe(true)
  })

  it("sizes the sheet to the visual viewport so the keyboard cannot push it", async () => {
    const listeners = new Set<EventListener>()
    const viewport = {
      offsetTop: 24,
      height: 420,
      addEventListener: vi.fn((_type: string, listener: EventListener) => listeners.add(listener)),
      removeEventListener: vi.fn((_type: string, listener: EventListener) => listeners.delete(listener)),
    }
    Object.defineProperty(window, "visualViewport", { configurable: true, value: viewport })

    const wrapper = mount(MobileQuickAdd, {
      global: { stubs: { AiImportPanel: AiImportPanelStub } },
    })
    await nextTick()

    const overlay = wrapper.find(".mobile-quick-add").element as HTMLElement
    expect(overlay.style.top).toBe("24px")
    expect(overlay.style.height).toBe("420px")

    viewport.offsetTop = 0
    viewport.height = 300
    listeners.forEach(listener => listener(new Event("resize")))
    await nextTick()

    expect(overlay.style.top).toBe("0px")
    expect(overlay.style.height).toBe("300px")

    wrapper.unmount()
    expect(viewport.removeEventListener).toHaveBeenCalledTimes(2)
  })
})
