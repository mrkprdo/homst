import { describe, it, expect, beforeEach, vi } from "vitest"
import { mount, flushPromises } from "@vue/test-utils"
import { nextTick } from "vue"
import MobileQuickAdd from "@/components/mobile/MobileQuickAdd.vue"
import { useEvents } from "@/composables/useEvents"
import { useTasks } from "@/composables/useTasks"
import { useMembers } from "@/composables/useMembers"
import { useSettings } from "@/composables/useSettings"

function seedMember(id = "m1", name = "Alice", color = "#00ff00") {
  useMembers().upsertMember({
    id, householdId: "h-1", name, avatarUrl: null, color,
    role: "admin", joinedAt: "",
  })
}

/** Find the <select> that contains an <option> with the given label. */
function selectWithOption(wrapper: ReturnType<typeof mount>, label: string) {
  const found = wrapper.findAll("select").find(s => s.findAll("option").some(o => o.text() === label))
  if (!found) throw new Error(`No select with option "${label}"`)
  return found
}

const wait = (ms: number) => new Promise(r => setTimeout(r, ms))

describe("MobileQuickAdd (event form)", () => {
  beforeEach(() => seedMember())

  it("shows the assignee colour dot once a member is chosen", async () => {
    const wrapper = mount(MobileQuickAdd)
    await flushPromises()
    await selectWithOption(wrapper, "No one").setValue("m1")
    await nextTick()
    expect(wrapper.find(".mqa-select-dot").attributes("style")).toContain("rgb(0, 255, 0)")
  })

  it("prefills the reminder from the household default and shows it in the summary", async () => {
    useSettings().updateDefaultReminderMinutes(10)
    const wrapper = mount(MobileQuickAdd)
    await flushPromises()

    await wrapper.find('input[placeholder="Event title"]').setValue("Coffee")
    const reminder = selectWithOption(wrapper, "10 minutes before")
    expect((reminder.element as HTMLSelectElement).value).toBe("10")
    expect(wrapper.find(".mqa-summary").text()).toContain("10 minutes before")
  })

  it("switches recurrence and end-repeat modes", async () => {
    const wrapper = mount(MobileQuickAdd)
    await flushPromises()
    expect(wrapper.find(".mqa-recur-end").exists()).toBe(false)

    await selectWithOption(wrapper, "Does not repeat").setValue("weekly")
    await nextTick()
    expect(wrapper.find(".mqa-recur-end").exists()).toBe(true)
    expect(wrapper.find(".mqa-summary").text()).toContain("Repeats weekly")

    await selectWithOption(wrapper, "Forever").setValue("date")
    await nextTick()
    expect(wrapper.find('.mqa-recur-end input[type="date"]').exists()).toBe(true)

    await selectWithOption(wrapper, "On date").setValue("count")
    await nextTick()
    expect(wrapper.find('.mqa-recur-end input[type="number"]').exists()).toBe(true)
    await wrapper.find('.mqa-recur-end input[type="number"]').setValue("3")
    expect(wrapper.find(".mqa-summary").text()).toContain("Repeats weekly")
  })

  it("hides the time controls when all-day is enabled", async () => {
    const wrapper = mount(MobileQuickAdd)
    await flushPromises()
    expect(wrapper.findAll('input[type="time"]')).toHaveLength(2)

    await wrapper.find(".mqa-checkbox").setValue(true)
    expect(wrapper.findAll('input[type="time"]')).toHaveLength(0)
    expect(wrapper.find(".mqa-summary").text()).toContain("All day")
  })

  it("summarises a cross-day event and submits the notes", async () => {
    const wrapper = mount(MobileQuickAdd)
    await flushPromises()
    await wrapper.find('input[placeholder="Event title"]').setValue("Overnight")

    let dates = wrapper.findAll('input[type="date"]')
    await dates[0]!.setValue("2026-08-01")
    await wrapper.find('input[placeholder="Same day"]').setValue("2026-08-02")

    let times = wrapper.findAll('input[type="time"]')
    await times[0]!.setValue("22:00")
    times = wrapper.findAll('input[type="time"]')
    await times[1]!.setValue("06:00")

    await wrapper.find(".mqa-textarea").setValue("Bring snacks")
    const summary = wrapper.find(".mqa-summary").text()
    expect(summary).toContain("Aug 1")
    expect(summary).toContain("Aug 2")

    await wrapper.find(".mqa-submit").trigger("click")
    await flushPromises()

    const ev = useEvents().events.value.find(e => e.title === "Overnight")!
    expect(ev.description).toBe("Bring snacks")
  })

  it("creates a multi-day all-day event, shows the toast and closes", async () => {
    const wrapper = mount(MobileQuickAdd)
    await flushPromises()
    await wrapper.find('input[placeholder="Event title"]').setValue("Road trip")

    const dates = wrapper.findAll('input[type="date"]')
    await dates[0]!.setValue("2026-07-01")
    await wrapper.find('input[placeholder="Same day"]').setValue("2026-07-03")
    await wrapper.find(".mqa-checkbox").setValue(true)

    await wrapper.find(".mqa-submit").trigger("click")
    await flushPromises()

    const ev = useEvents().events.value.find(e => e.title === "Road trip")!
    expect(ev.allDay).toBe(true)
    expect(ev.endAt).toBeTruthy()

    expect(wrapper.find(".mqa-toast").text()).toContain("Created!")
    await wait(900)
    expect(wrapper.emitted("close")).toBeTruthy()
  })

  it("blocks submit when the time range is invalid", async () => {
    const wrapper = mount(MobileQuickAdd)
    await flushPromises()
    await wrapper.find('input[placeholder="Event title"]').setValue("Bad range")

    let times = wrapper.findAll('input[type="time"]')
    await times[0]!.setValue("10:00")
    times = wrapper.findAll('input[type="time"]')
    await times[1]!.setValue("09:00")

    expect(wrapper.find(".mqa-error").text()).toContain("End time must be after the start time")
    expect(wrapper.find(".mqa-submit").attributes("disabled")).toBeDefined()

    await wrapper.find(".mqa-submit").trigger("click")
    await flushPromises()
    expect(useEvents().events.value.filter(e => e.title === "Bad range")).toHaveLength(0)
  })

  it("applies a quick-duration preset", async () => {
    const wrapper = mount(MobileQuickAdd)
    await flushPromises()
    const chips = wrapper.findAll(".mqa-duration-chip")
    expect(chips.map(c => c.text())).toEqual(["15m", "30m", "1h", "2h"])

    await chips[3]!.trigger("click")
    const times = wrapper.findAll('input[type="time"]')
    expect((times[0]!.element as HTMLInputElement).value).toBeTruthy()
    expect((times[1]!.element as HTMLInputElement).value).toBeTruthy()
    expect((times[0]!.element as HTMLInputElement).value)
      .not.toBe((times[1]!.element as HTMLInputElement).value)
  })

  it("emits close from the X and Cancel buttons", async () => {
    const wrapper = mount(MobileQuickAdd)
    await wrapper.find(".mqa-close").trigger("click")
    await wrapper.find(".mqa-cancel").trigger("click")
    expect(wrapper.emitted("close")).toHaveLength(2)
  })

  it("ignores a blank event submission", async () => {
    const wrapper = mount(MobileQuickAdd)
    await flushPromises()
    await wrapper.find(".mqa-submit").trigger("click")
    await flushPromises()
    expect(useEvents().events.value).toHaveLength(0)
  })

  it("submits recurrence rules with a date and a count", async () => {
    const wrapper = mount(MobileQuickAdd)
    await flushPromises()
    await wrapper.find('input[placeholder="Event title"]').setValue("Weekly date")
    await selectWithOption(wrapper, "Does not repeat").setValue("weekly")
    await selectWithOption(wrapper, "Forever").setValue("date")
    await wrapper.find('.mqa-recur-end input[type="date"]').setValue("2026-09-30")
    await wrapper.find(".mqa-submit").trigger("click")
    await flushPromises()
    const dated = useEvents().events.value.find(e => e.title === "Weekly date")!
    expect(dated.recurrence).toMatchObject({ freq: "weekly" })
    expect((dated.recurrence as any)?.until).toBeTruthy()

    await wrapper.findAll(".mqa-tab")[0]!.trigger("click")
    await nextTick()
    await wrapper.find('input[placeholder="Event title"]').setValue("Weekly count")
    await selectWithOption(wrapper, "Does not repeat").setValue("daily")
    await selectWithOption(wrapper, "Forever").setValue("count")
    await wrapper.find('.mqa-recur-end input[type="number"]').setValue("3")
    await selectWithOption(wrapper, "No reminder").setValue("15")
    await wrapper.find(".mqa-submit").trigger("click")
    await flushPromises()
    const counted = useEvents().events.value.find(e => e.title === "Weekly count")!
    expect(counted.recurrence).toMatchObject({ freq: "daily", count: 3 })

    await wrapper.find('input[placeholder="Event title"]').setValue("Weekly forever")
    await selectWithOption(wrapper, "Forever").setValue("forever")
    await wrapper.find(".mqa-submit").trigger("click")
    await flushPromises()
    const forever = useEvents().events.value.find(e => e.title === "Weekly forever")!
    expect(forever.recurrence).toMatchObject({ freq: "daily" })
    expect(forever.recurrence).not.toHaveProperty("count")
    expect(forever.recurrence).not.toHaveProperty("until")  })

  it("keeps the end date on or after the start date", async () => {
    const wrapper = mount(MobileQuickAdd)
    await flushPromises()
    const dates = wrapper.findAll('input[type="date"]')
    await wrapper.find('input[placeholder="Same day"]').setValue("2026-09-10")
    await dates[0]!.setValue("2026-09-20")
    await nextTick()
    const end = wrapper.find('input[placeholder="Same day"]').element as HTMLInputElement
    expect(end.value).toBe("2026-09-20")
  })
})

describe("MobileQuickAdd (task form)", () => {
  beforeEach(() => seedMember())

  it("shows the task assignee dot and creates a task", async () => {
    const wrapper = mount(MobileQuickAdd)
    await flushPromises()
    await wrapper.findAll(".mqa-tab")[1]!.trigger("click")
    await nextTick()

    expect(wrapper.find(".mqa-submit").attributes("disabled")).toBeDefined()
    await selectWithOption(wrapper, "No one").setValue("m1")
    await nextTick()
    expect(wrapper.findAll(".mqa-select-dot").length).toBeGreaterThan(0)

    await wrapper.find('input[placeholder="Task title"]').setValue("Water plants")
    await wrapper.findAll(".mqa-priority-btn")[2]!.trigger("click")
    await wrapper.find('.mqa-input[type="date"]').setValue("2026-06-01")
    await wrapper.find(".mqa-textarea").setValue("Daily")

    await wrapper.find(".mqa-submit").trigger("click")
    await flushPromises()

    const task = useTasks().tasks.value.find(t => t.title === "Water plants")!
    expect(task.priority).toBe("high")
    expect(task.startAt).toBeTruthy()
    expect(task.description).toBe("Daily")

    await wait(900)
    expect(wrapper.emitted("close")).toBeTruthy()
  })

  it("does not submit a blank task", async () => {
    const wrapper = mount(MobileQuickAdd)
    await flushPromises()
    await wrapper.findAll(".mqa-tab")[1]!.trigger("click")
    await nextTick()
    await wrapper.find(".mqa-submit").trigger("click")
    await flushPromises()
    expect(useTasks().tasks.value).toHaveLength(0)
  })
})
