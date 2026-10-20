import { describe, it, expect, beforeEach, vi } from "vitest"
import { mount } from "@vue/test-utils"
import QuickAddForm from "@/components/shared/QuickAddForm.vue"
import { useUi } from "@/composables/useUi"
import { useEvents } from "@/composables/useEvents"
import { useTasks } from "@/composables/useTasks"
import { useMembers } from "@/composables/useMembers"

function seedCalendar(id = "cal-default") {
  useEvents().upsertCalendar({
    id, householdId: "h-1", name: "Family", color: "forest",
    source: "internal", feedUrl: null, isVisible: true, createdBy: "u-1",
  })
}

function seedMember(id = "m1", name = "Alice", color = "#00ff00") {
  useMembers().upsertMember({
    id, householdId: "h-1", name, avatarUrl: null, color,
    role: "member", joinedAt: "",
  })
}

function field(wrapper: ReturnType<typeof mount>, label: string) {
  return wrapper.findAll(".ui-field").find(f => f.text().includes(label))
}

const settle = () => new Promise(r => setTimeout(r, 0))

describe("QuickAddForm (event details)", () => {
  beforeEach(() => {
    useUi().activePanel.value = "calendar"
    seedCalendar()
    seedMember()
  })

  it("offers an assignee select once members exist", () => {
    const wrapper = mount(QuickAddForm)
    const assigned = field(wrapper, "Assigned to")!
    expect(assigned).toBeTruthy()
    expect(assigned.findAll("option").map(o => o.text())).toContain("Alice")
  })

  it("reveals the repeat-end controls when a recurrence is chosen", async () => {
    const wrapper = mount(QuickAddForm)
    expect(field(wrapper, "End repeat")).toBeUndefined()

    await field(wrapper, "Repeat")!.find("select").setValue("weekly")
    expect(field(wrapper, "End repeat")).toBeTruthy()
    expect(wrapper.find(".summary-preview").text()).toContain("Repeats weekly")

    await field(wrapper, "End repeat")!.find("select").setValue("date")
    expect(field(wrapper, "Until")).toBeTruthy()

    await field(wrapper, "End repeat")!.find("select").setValue("count")
    expect(field(wrapper, "Times")).toBeTruthy()
  })

  it("summarises a multi-day all-day event", async () => {
    const wrapper = mount(QuickAddForm)
    await wrapper.find("input[placeholder='Event title']").setValue("Trip")
    let dates = wrapper.findAll("input[type='date']")
    await dates[0]!.setValue("2026-07-01")
    dates = wrapper.findAll("input[type='date']")
    await dates[1]!.setValue("2026-07-03")
    await wrapper.findComponent({ name: "UiToggle" }).trigger("click")

    const text = wrapper.find(".summary-preview").text()
    expect(text).toContain("All day")
    expect(text).toContain("Jul 1")
    expect(text).toContain("Jul 3")
  })

  it("summarises a cross-day timed event", async () => {
    const wrapper = mount(QuickAddForm)
    await wrapper.find("input[placeholder='Event title']").setValue("Overnight")
    let dates = wrapper.findAll("input[type='date']")
    await dates[0]!.setValue("2026-08-01")
    dates = wrapper.findAll("input[type='date']")
    await dates[1]!.setValue("2026-08-02")

    let times = wrapper.findAll("input[type='time']")
    await times[0]!.setValue("22:00")
    times = wrapper.findAll("input[type='time']")
    await times[1]!.setValue("06:00")

    const text = wrapper.find(".summary-preview").text()
    expect(text).toContain("Aug 1")
    expect(text).toContain("Aug 2")
  })

  it("includes the chosen reminder in the summary", async () => {
    const wrapper = mount(QuickAddForm)
    await wrapper.find("input[placeholder='Event title']").setValue("Call")
    await field(wrapper, "Remind me")!.find("select").setValue("30")
    expect(wrapper.find(".summary-preview").text()).toContain("30 minutes before")
  })

  it("warns and blocks submit when the end time precedes the start time", async () => {
    const wrapper = mount(QuickAddForm)
    await wrapper.find("input[placeholder='Event title']").setValue("Bad range")
    let times = wrapper.findAll("input[type='time']")
    await times[0]!.setValue("10:00")
    times = wrapper.findAll("input[type='time']")
    await times[1]!.setValue("09:00")

    expect(wrapper.find(".form-error").text()).toContain("End time must be after the start time")
    expect(wrapper.findAllComponents({ name: "UiButton" })[1]!.props("disabled")).toBe(true)
  })

  it("warns when the end date precedes the start date", async () => {
    const wrapper = mount(QuickAddForm)
    await wrapper.find("input[placeholder='Event title']").setValue("Bad dates")
    let dates = wrapper.findAll("input[type='date']")
    await dates[0]!.setValue("2026-09-10")
    dates = wrapper.findAll("input[type='date']")
    await dates[1]!.setValue("2026-09-05")

    expect(wrapper.find(".form-error").text()).toContain("End date can't be before the start date")
  })

  it("clamps the end date when the start date moves past it", async () => {
    const wrapper = mount(QuickAddForm)
    let dates = wrapper.findAll("input[type='date']")
    await dates[0]!.setValue("2026-09-10")
    dates = wrapper.findAll("input[type='date']")
    await dates[1]!.setValue("2026-09-20")

    dates = wrapper.findAll("input[type='date']")
    await dates[0]!.setValue("2026-09-25")

    dates = wrapper.findAll("input[type='date']")
    expect((dates[1]!.element as HTMLInputElement).value).toBe("2026-09-25")
  })

  it("fills the end time automatically when the start time is set", async () => {
    const wrapper = mount(QuickAddForm)
    let times = wrapper.findAll("input[type='time']")
    await times[0]!.setValue("10:00")
    times = wrapper.findAll("input[type='time']")
    expect((times[1]!.element as HTMLInputElement).value).toBe("11:00")
  })

  it("applies a quick-duration preset", async () => {
    const wrapper = mount(QuickAddForm)
    const chips = wrapper.findAll(".duration-chip")
    expect(chips.map(c => c.text())).toEqual(["15m", "30m", "1h", "2h"])

    await chips[1]!.trigger("click")
    const times = wrapper.findAll("input[type='time']")
    const start = (times[0]!.element as HTMLInputElement).value
    const end = (times[1]!.element as HTMLInputElement).value
    expect(start).toBeTruthy()
    expect(end).toBeTruthy()
    expect(start).not.toBe(end)
  })

  it("creates a multi-day all-day event with an inclusive end", async () => {
    const ui = useUi()
    ui.isDrawerOpen.value = true
    const { events } = useEvents()

    const wrapper = mount(QuickAddForm)
    await wrapper.find("input[placeholder='Event title']").setValue("Trip")
    let dates = wrapper.findAll("input[type='date']")
    await dates[0]!.setValue("2026-07-01")
    dates = wrapper.findAll("input[type='date']")
    await dates[1]!.setValue("2026-07-03")
    await wrapper.findComponent({ name: "UiToggle" }).trigger("click")

    await wrapper.findAllComponents({ name: "UiButton" })[1]!.trigger("click")
    await settle()

    const ev = events.value[0]!
    expect(ev.allDay).toBe(true)
    expect(ev.endAt).toBeTruthy()
    expect(ui.isDrawerOpen.value).toBe(false)
  })

  it("prefills the date and time when opened from the calendar", async () => {
    const ui = useUi()
    ui.drawer.value = { type: "quick-add", id: null, date: "2026-11-11", time: "14:30" }
    const wrapper = mount(QuickAddForm)

    const dates = wrapper.findAll("input[type='date']")
    expect((dates[0]!.element as HTMLInputElement).value).toBe("2026-11-11")
    const times = wrapper.findAll("input[type='time']")
    expect((times[0]!.element as HTMLInputElement).value).toBe("14:30")
    expect((times[1]!.element as HTMLInputElement).value).toBe("15:30")
  })
})

describe("QuickAddForm (task details)", () => {
  beforeEach(() => {
    useUi().activePanel.value = "tasks"
    seedMember()
  })

  it("shows the assignee colour dot for the selected member", async () => {
    const wrapper = mount(QuickAddForm)
    const assigned = field(wrapper, "Assigned to")!
    await assigned.find("select").setValue("m1")
    expect(wrapper.find(".assignee-dot").attributes("style")).toContain("rgb(0, 255, 0)")
  })

  it("creates a General list when the household has none", async () => {
    const ui = useUi()
    ui.isDrawerOpen.value = true
    const { lists, tasks } = useTasks()

    const wrapper = mount(QuickAddForm)
    await settle()

    vi.mocked(fetch).mockImplementationOnce(async () =>
      new Response(JSON.stringify({
        id: "tl-new", household_id: "h-1", name: "General", color: "#948f8f", position: 0,
      }), { status: 200, headers: { "content-type": "application/json" } }),
    )

    await wrapper.find("input[placeholder='Task title']").setValue("Solo task")
    await wrapper.findAllComponents({ name: "UiButton" })[1]!.trigger("click")
    await settle()

    expect(lists.value.some(l => l.id === "tl-new")).toBe(true)
    expect(tasks.value).toHaveLength(1)
    expect(tasks.value[0]!.title).toBe("Solo task")
  })

  it("does not submit a blank task", async () => {
    const { tasks } = useTasks()
    const wrapper = mount(QuickAddForm)
    await wrapper.find(".quick-add-form").trigger("keydown", { key: "Enter", shiftKey: false })
    expect(tasks.value).toHaveLength(0)
  })
})

describe("QuickAddForm (no active panel)", () => {
  it("renders nothing submittable outside the calendar and task panels", () => {
    useUi().activePanel.value = "settings"
    const wrapper = mount(QuickAddForm)
    expect(wrapper.find(".quick-add-form").exists()).toBe(true)
    expect(wrapper.find("input[placeholder='Event title']").exists()).toBe(false)
    expect(wrapper.find("input[placeholder='Task title']").exists()).toBe(false)
  })
})
