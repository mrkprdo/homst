import { describe, expect, it, vi } from "vitest"
import { mount } from "@vue/test-utils"
import { nextTick } from "vue"
import QuickAddForm from "@/components/shared/QuickAddForm.vue"
import { useUi } from "@/composables/useUi"
import { useEvents } from "@/composables/useEvents"

const AiImportPanelStub = {
  name: "AiImportPanel",
  emits: ["done", "manual"],
  template: `
    <div>
      <button class="ai-stub" @click="$emit('done', 2)">AI stub</button>
      <button class="ai-manual-stub" @click="$emit('manual')">Add manually</button>
    </div>
  `,
}

const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>

function mountForm() {
  useUi().activePanel.value = "calendar"
  useEvents().upsertCalendar({
    id: "cal-1", householdId: "h", name: "Family", color: "sage",
    source: "internal", feedUrl: null, isVisible: true, createdBy: null,
  })
  return mount(QuickAddForm, {
    global: { stubs: { AiImportPanel: AiImportPanelStub } },
  })
}

describe("QuickAddForm AI mode", () => {
  it("starts in Smart import and switches to manual fields", async () => {
    const wrapper = mountForm()

    const modes = wrapper.findAll(".mode-switch__btn").map(button => button.text())
    expect(modes).toEqual(["Smart import", "Manual"])
    expect(wrapper.find(".ai-stub").exists()).toBe(true)
    expect(wrapper.find("input[placeholder='Event title']").exists()).toBe(false)

    await wrapper.findAll("button").find(button => button.text() === "Manual")!.trigger("click")
    expect(wrapper.find("input[placeholder='Event title']").exists()).toBe(true)
    expect(wrapper.find(".ai-stub").exists()).toBe(false)

    await wrapper.findAll("button").find(button => button.text() === "Smart import")!.trigger("click")
    expect(wrapper.find(".ai-stub").exists()).toBe(true)
  })

  it("closes the drawer when the importer finishes", async () => {
    const ui = useUi()
    const wrapper = mountForm()

    await wrapper.find(".ai-stub").trigger("click")
    expect(ui.drawer.value.type).toBeNull()
  })

  it("switches to the manual form when the importer asks for it", async () => {
    const wrapper = mountForm()

    await wrapper.find(".ai-manual-stub").trigger("click")

    expect(wrapper.find("input[placeholder='Event title']").exists()).toBe(true)
    expect(wrapper.find(".ai-stub").exists()).toBe(false)
  })

  it("does not submit the manual form from AI mode", async () => {
    const wrapper = mountForm()
    fetchMock.mockClear()

    await wrapper.find(".quick-add-form").trigger("keydown", { key: "Enter" })
    expect(fetchMock.mock.calls.some(call => String(call[0]).includes("/events"))).toBe(false)
    vi.restoreAllMocks()
  })

  it("only offers Smart import in the calendar quick-add", async () => {
    const wrapper = mountForm()
    expect(wrapper.find(".ai-stub").exists()).toBe(true)

    useUi().activePanel.value = "tasks"
    await nextTick()

    expect(wrapper.find(".mode-switch").exists()).toBe(false)
    expect(wrapper.find(".ai-stub").exists()).toBe(false)
    expect(wrapper.find("input[placeholder='Task title']").exists()).toBe(true)
  })

  it("opens Smart import by default from an event shortcut outside the calendar", async () => {
    const ui = useUi()
    ui.activePanel.value = "home"
    ui.openDrawer("quick-add", undefined, "2026-11-20", undefined, "event")

    const wrapper = mount(QuickAddForm, {
      global: { stubs: { AiImportPanel: AiImportPanelStub } },
    })

    expect(wrapper.find(".mode-switch").exists()).toBe(true)
    expect(wrapper.find(".ai-stub").exists()).toBe(true)
    expect(wrapper.find("input[placeholder='Task title']").exists()).toBe(false)

    await wrapper.findAll("button").find(button => button.text() === "Manual")!.trigger("click")
    expect(wrapper.find("input[placeholder='Event title']").exists()).toBe(true)
  })
})
