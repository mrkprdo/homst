import { describe, it, expect, vi } from "vitest"
import { mount, flushPromises } from "@vue/test-utils"
import { nextTick } from "vue"
import CalendarView from "@/components/calendar/CalendarView.vue"
import { useEvents, type Event } from "@/composables/useEvents"
import { useMembers } from "@/composables/useMembers"
import { useUi } from "@/composables/useUi"

function seedCalendar(id = "cal-1") {
  useEvents().upsertCalendar({
    id, householdId: "h-1", name: "Family", color: "peach",
    source: "internal", feedUrl: null, isVisible: true, createdBy: "u-1",
  })
}

function seedEvent(overrides: Partial<Event> & { id: string }) {
  const base: Event = {
    id: overrides.id, calendarId: "cal-1", title: "Event", description: "",
    startAt: new Date().toISOString(), endAt: null, allDay: false,
    recurrence: null, source: "internal", externalUid: null,
    createdBy: "u-1", createdAt: "", updatedAt: "",
  }
  useEvents().upsertEvent({ ...base, ...overrides })
}

/** Click the segmented control: 0 = month, 1 = week, 2 = day. */
async function switchView(wrapper: ReturnType<typeof mount>, index: number) {
  const seg = wrapper.findComponent({ name: "UiSegmentedControl" })
  await seg.findAll(".segmented-btn")[index]!.trigger("click")
  await nextTick()
}

describe("CalendarView (assignees)", () => {
  it("colours and prefixes assigned events using the member", () => {
    seedCalendar()
    useMembers().upsertMember({
      id: "m1", householdId: "h-1", name: "Alice", avatarUrl: null,
      color: "#ff0000", role: "member", joinedAt: "",
    })
    const now = new Date()
    seedEvent({
      id: "evt-assign", title: "Standup", assigneeId: "m1",
      startAt: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 9, 0).toISOString(),
      endAt: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 10, 0).toISOString(),
    })

    const wrapper = mount(CalendarView)
    expect(wrapper.text()).toContain("Alice - Standup")
  })

  it("uses the palette colour when the member has a named colour", () => {
    seedCalendar()
    useMembers().upsertMember({
      id: "m2", householdId: "h-1", name: "Bob", avatarUrl: null,
      color: "sage-base", role: "member", joinedAt: "",
    })
    const now = new Date()
    seedEvent({
      id: "evt-pal", title: "Chores", assigneeId: "m2",
      startAt: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 11, 0).toISOString(),
      endAt: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0).toISOString(),
    })

    const wrapper = mount(CalendarView)
    expect(wrapper.text()).toContain("Bob - Chores")
  })

  it("falls back to the unassigned colour for an unknown assignee", () => {
    seedCalendar()
    const now = new Date()
    seedEvent({
      id: "evt-ghost", title: "Mystery", assigneeId: "nobody",
      startAt: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 13, 0).toISOString(),
      endAt: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 14, 0).toISOString(),
    })

    const wrapper = mount(CalendarView)
    // Unassigned fallback: the plain title is shown, not a member prefix.
    expect(wrapper.text()).toContain("Mystery")
    expect(wrapper.text()).not.toContain("nobody")
  })
})

describe("CalendarView (month navigation)", () => {
  it("wraps backwards across the year boundary", async () => {
    const wrapper = mount(CalendarView)
    const prev = wrapper.findAll(".nav-arrow")[0]!
    for (let i = 0; i < 13; i++) {
      await prev.trigger("click")
      await nextTick()
    }
    expect(wrapper.find(".month-grid").exists()).toBe(true)
  })

  it("wraps forwards across the year boundary", async () => {
    const wrapper = mount(CalendarView)
    const next = wrapper.findAll(".nav-arrow")[1]!
    for (let i = 0; i < 4; i++) {
      await next.trigger("click")
      await nextTick()
    }
    expect(wrapper.find(".month-grid").exists()).toBe(true)
  })

  it("clicking a trailing day navigates to the previous month", async () => {
    const wrapper = mount(CalendarView)
    const daysInCurrent = wrapper.findAll(".day-cell:not(.adjacent)").length
    const adjacent = wrapper.findAll(".day-cell.adjacent")
    expect(adjacent.length).toBeGreaterThan(0)

    await adjacent[0]!.trigger("click")
    await nextTick()
    // The grid now shows a different (neighbouring) month.
    expect(wrapper.findAll(".day-cell:not(.adjacent)").length).not.toBe(daysInCurrent)
  })

  it("clicking a leading day navigates to the next month", async () => {
    const wrapper = mount(CalendarView)
    const daysInCurrent = wrapper.findAll(".day-cell:not(.adjacent)").length
    const adjacent = wrapper.findAll(".day-cell.adjacent")

    await adjacent[adjacent.length - 1]!.trigger("click")
    await nextTick()
    expect(wrapper.findAll(".day-cell:not(.adjacent)").length).not.toBe(daysInCurrent)
  })

  it("marks today and the selected day", async () => {
    const wrapper = mount(CalendarView)
    expect(wrapper.find(".day-cell.today").exists()).toBe(true)

    const days = wrapper.findAll(".day-cell:not(.adjacent)")
    await days[4]!.trigger("click")
    await nextTick()
    expect(days[4]!.classes()).toContain("selected")
  })

  it("double-clicking a day opens quick-add prefilled with that date", async () => {
    const wrapper = mount(CalendarView)
    const ui = useUi()
    const days = wrapper.findAll(".day-cell:not(.adjacent)")
    await days[9]!.trigger("dblclick")
    expect(ui.drawer.value.type).toBe("quick-add")
    expect(ui.drawer.value.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})

describe("CalendarView (event interaction)", () => {
  it("clicking an event chip opens the event detail drawer", async () => {
    seedCalendar()
    const now = new Date()
    seedEvent({
      id: "evt-chip", title: "Chip Event",
      startAt: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 15, 0).toISOString(),
      endAt: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 16, 0).toISOString(),
    })

    const wrapper = mount(CalendarView)
    const chip = wrapper.findAllComponents({ name: "EventChip" })[0]!
    await chip.trigger("click")

    const ui = useUi()
    expect(ui.drawer.value.type).toBe("event-detail")
    expect(ui.drawer.value.id).toBe("evt-chip")
  })

  it("strips the recurrence suffix when opening a recurring occurrence", async () => {
    seedCalendar()
    const now = new Date()
    seedEvent({
      id: "evt-rec", title: "Recurring",
      startAt: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 15, 0).toISOString(),
      endAt: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 16, 0).toISOString(),
      recurrence: { freq: "weekly", count: 3 },
    })

    const wrapper = mount(CalendarView)
    // The first chip may be an expanded occurrence; open it and check the base id.
    await wrapper.findAllComponents({ name: "EventChip" })[0]!.trigger("click")
    expect(useUi().drawer.value.id).toBe("evt-rec")
  })

  it("shows '+N more' when a day has more than three events", () => {
    seedCalendar()
    const now = new Date()
    for (let i = 0; i < 5; i++) {
      seedEvent({
        id: `evt-many-${i}`, title: `Many ${i}`,
        startAt: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 8 + i, 0).toISOString(),
        endAt: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 8 + i, 30).toISOString(),
      })
    }

    const wrapper = mount(CalendarView)
    expect(wrapper.find(".more-events").text()).toContain("+2 more")
  })
})

describe("CalendarView (recurrence expansion)", () => {
  it("expands daily, weekly, biweekly, monthly, yearly and unknown frequencies", () => {
    seedCalendar()
    const now = new Date()
    const todayAt9 = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 9, 0)
    const twoYearsAgo = new Date(now.getFullYear() - 2, now.getMonth(), now.getDate(), 9, 0)
    const threeYearsAgo = new Date(now.getFullYear() - 3, now.getMonth(), now.getDate(), 9, 0)

    const base = { allDay: false, description: "", source: "internal" as const }

    seedEvent({ ...base, id: "rec-daily", title: "Daily", startAt: twoYearsAgo.toISOString(), endAt: new Date(twoYearsAgo.getTime() + 3_600_000).toISOString(), recurrence: { freq: "daily", count: 10 } })
    seedEvent({ ...base, id: "rec-weekly", title: "Weekly", startAt: todayAt9.toISOString(), endAt: new Date(todayAt9.getTime() + 3_600_000).toISOString(), recurrence: { freq: "weekly", count: 5 } })
    seedEvent({ ...base, id: "rec-biweekly", title: "Biweekly", startAt: todayAt9.toISOString(), endAt: new Date(todayAt9.getTime() + 3_600_000).toISOString(), recurrence: { freq: "biweekly", until: new Date(now.getTime() + 60 * 86_400_000).toISOString() } })
    seedEvent({ ...base, id: "rec-monthly", title: "Monthly", startAt: threeYearsAgo.toISOString(), endAt: new Date(threeYearsAgo.getTime() + 3_600_000).toISOString(), recurrence: { freq: "monthly", count: 6 } })
    seedEvent({ ...base, id: "rec-yearly", title: "Yearly", startAt: todayAt9.toISOString(), endAt: new Date(todayAt9.getTime() + 3_600_000).toISOString(), recurrence: { freq: "yearly", count: 2 } })

    const wrapper = mount(CalendarView)
    const text = wrapper.text()
    expect(text).toContain("Weekly")
    expect(text).toContain("Yearly")
    expect(text).toContain("Biweekly")
  })

  it("treats an unknown frequency as a single occurrence", () => {
    seedCalendar()
    const now = new Date()
    seedEvent({
      id: "rec-unknown", title: "Hourlyish",
      startAt: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 9, 0).toISOString(),
      endAt: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 10, 0).toISOString(),
      recurrence: { freq: "hourly", count: 3 },
    })
    const wrapper = mount(CalendarView)
    expect(wrapper.text()).toContain("Hourlyish")
  })

  it("treats a recurrence with no frequency as a single event", () => {
    seedCalendar()
    const now = new Date()
    seedEvent({
      id: "rec-none", title: "NoFreq",
      startAt: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 10, 0).toISOString(),
      endAt: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 11, 0).toISOString(),
      recurrence: {},
    })
    const wrapper = mount(CalendarView)
    expect(wrapper.text()).toContain("NoFreq")
  })
})

describe("CalendarView (week & day layout)", () => {
  it("scrolls the week grid near the current time and shows the now line", async () => {
    const wrapper = mount(CalendarView)
    await switchView(wrapper, 1)
    await nextTick()

    expect(wrapper.find(".week-grid").exists()).toBe(true)
    expect(wrapper.find(".week-today-strip").exists()).toBe(true)
    expect(wrapper.find(".week-now-line").exists()).toBe(true)
    expect(wrapper.find(".week-scroll").element.scrollTop).toBe(56 * Math.max(0, new Date().getHours() - 2))
  })

  it("scrolls the day grid near the current time", async () => {
    const wrapper = mount(CalendarView)
    await switchView(wrapper, 2)
    await nextTick()
    expect(wrapper.find(".day-scroll").element.scrollTop).toBe(56 * Math.max(0, new Date().getHours() - 2))
  })

  it("places overlapping week events side by side and compacts short ones", async () => {
    seedCalendar()
    const now = new Date()
    const at = (h: number, m: number) =>
      new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m).toISOString()

    seedEvent({ id: "ov-long", title: "Long block", startAt: at(9, 0), endAt: at(10, 30) })
    seedEvent({ id: "ov-short", title: "Short block", startAt: at(9, 30), endAt: at(10, 0) })
    seedEvent({ id: "ov-tail", title: "Tail block", startAt: at(10, 0), endAt: at(10, 30) })

    const wrapper = mount(CalendarView)
    await switchView(wrapper, 1)
    await nextTick()

    const long = wrapper.findAll(".week-event-block").find(block => block.text().includes("Long block"))
    const short = wrapper.findAll(".week-event-block").find(block => block.text().includes("Short block"))
    const tail = wrapper.findAll(".week-event-block").find(block => block.text().includes("Tail block"))
    expect(long).toBeTruthy()
    expect(short).toBeTruthy()
    expect(tail).toBeTruthy()
    expect(long!.attributes("data-lanes")).toBe("2")
    expect(short!.attributes("data-lanes")).toBe("2")
    expect(tail!.attributes("data-lanes")).toBe("2")
    expect(long!.attributes("data-lane")).not.toBe(short!.attributes("data-lane"))
    expect(tail!.attributes("data-lane")).toBe(short!.attributes("data-lane"))
    expect(short!.classes()).toContain("is-compact")
    expect(long!.classes()).not.toContain("is-compact")
  })

  it("opens a week column header in day view", async () => {
    const wrapper = mount(CalendarView)
    await switchView(wrapper, 1)
    await nextTick()

    await wrapper.findAll(".week-col-header")[3]!.trigger("click")
    await nextTick()
    expect(wrapper.find(".day-view").exists()).toBe(true)
  })

  it("renders an all-day row in the week view for all-day events", async () => {
    seedCalendar()
    const now = new Date()
    const iso = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0).toISOString()
    seedEvent({ id: "ad-1", title: "Holiday", startAt: iso, endAt: iso, allDay: true })

    const wrapper = mount(CalendarView)
    await switchView(wrapper, 1)
    await nextTick()
    expect(wrapper.find(".week-all-day").exists()).toBe(true)
  })

  it("renders the all-day row in the day view", async () => {
    seedCalendar()
    const now = new Date()
    const iso = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0).toISOString()
    seedEvent({ id: "ad-2", title: "All Day", startAt: iso, endAt: iso, allDay: true })

    const wrapper = mount(CalendarView)
    await switchView(wrapper, 2)
    await nextTick()
    expect(wrapper.find(".day-all-day").exists()).toBe(true)
    expect(wrapper.find(".day-all-day").text()).toContain("All Day")
  })

  it("clamps a multi-day event to the visible column", async () => {
    seedCalendar()
    const now = new Date()
    // Started yesterday evening, ends early today — must clamp to today's column.
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 23, 0)
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 1, 0)
    seedEvent({ id: "span-1", title: "Overnight", startAt: start.toISOString(), endAt: end.toISOString() })

    const wrapper = mount(CalendarView)
    await switchView(wrapper, 1)
    await nextTick()
    const blocks = wrapper.findAll(".week-event-block")
    expect(blocks.length).toBeGreaterThan(0)
    // One column shows the tail end of the event clamped to the top of the day.
    const styles = blocks.map(b => b.attributes("style") ?? "")
    expect(styles.some(s => s.includes("top: 0px"))).toBe(true)
  })

  it("opens quick-add with a time when clicking an empty week slot", async () => {
    const wrapper = mount(CalendarView)
    await switchView(wrapper, 1)
    await nextTick()

    const col = wrapper.find(".week-event-col")
    col.element.dispatchEvent(new MouseEvent("click", { clientY: 3 * 56, bubbles: true }))
    await nextTick()

    const ui = useUi()
    expect(ui.drawer.value.type).toBe("quick-add")
    expect(ui.drawer.value.time).toBe("03:00")
  })

  it("opens quick-add when clicking an empty day slot", async () => {
    const wrapper = mount(CalendarView)
    await switchView(wrapper, 2)
    await nextTick()

    const col = wrapper.find(".day-event-col")
    col.element.dispatchEvent(new MouseEvent("click", { clientY: 56, bubbles: true }))
    await nextTick()

    const ui = useUi()
    expect(ui.drawer.value.type).toBe("quick-add")
    expect(ui.drawer.value.time).toBe("01:00")
  })

  it("shows a week nav label and navigates weeks", async () => {
    const wrapper = mount(CalendarView)
    await switchView(wrapper, 1)
    // The toolbar label cross-fades between views; let the transition settle.
    await new Promise((resolve) => setTimeout(resolve, 120))
    await nextTick()
    expect(wrapper.html()).toContain("–")

    await wrapper.findAll(".nav-arrow")[1]!.trigger("click")
    await nextTick()
    expect(wrapper.find(".week-grid").exists()).toBe(true)
    await wrapper.findAll(".nav-arrow")[0]!.trigger("click")
    await nextTick()
    expect(wrapper.find(".week-grid").exists()).toBe(true)
  })

  it("navigates days backwards", async () => {
    const wrapper = mount(CalendarView)
    await switchView(wrapper, 2)
    await nextTick()
    const before = wrapper.find(".day-banner-date").text()
    await wrapper.findAll(".nav-arrow")[0]!.trigger("click")
    await nextTick()
    expect(wrapper.find(".day-banner-date").text()).not.toBe(before)
  })
})

describe("CalendarView (lifecycle)", () => {
  it("refreshes the clock every minute and clears the interval on unmount", async () => {
    vi.useFakeTimers()
    try {
      const wrapper = mount(CalendarView)
      await flushPromises()
      vi.advanceTimersByTime(60_000)
      await nextTick()
      expect(wrapper.find(".calendar-view").exists()).toBe(true)
      wrapper.unmount()
    } finally {
      vi.useRealTimers()
    }
  })

  it("shows the loading skeleton while events load", async () => {
    const { loading } = useEvents()
    const wrapper = mount(CalendarView)
    loading.value = true
    await nextTick()
    expect(wrapper.find(".skeleton-grid").exists()).toBe(true)
  })

  it("opens event details from week and day event blocks", async () => {
    seedCalendar()
    const now = new Date()
    seedEvent({
      id: "evt-click",
      title: "Clickable",
      startAt: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 9, 0).toISOString(),
      endAt: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 10, 0).toISOString(),
    })
    const ui = useUi()
    const wrapper = mount(CalendarView)

    await switchView(wrapper, 1)
    await wrapper.find(".week-event-block").trigger("click")
    expect(ui.drawer.value.type).toBe("event-detail")
    expect(ui.drawer.value.id).toBe("evt-click")
    ui.closeDrawer()
    await nextTick()

    await switchView(wrapper, 2)
    await wrapper.find(".day-event-block").trigger("click")
    expect(ui.drawer.value.type).toBe("event-detail")
    expect(ui.drawer.value.id).toBe("evt-click")
  })

  it("moves both ways when an adjacent month cell is clicked", async () => {
    const wrapper = mount(CalendarView)
    // Move to a month that has trailing next-month cells in its grid.
    await wrapper.findAll(".nav-arrow")[1]!.trigger("click")
    await nextTick()
    const nextCell = wrapper.findAll(".day-cell.adjacent").at(-1)!
    await nextCell.trigger("click")
    await nextTick()
    expect(wrapper.find(".month-grid").exists()).toBe(true)

    const backCell = wrapper.findAll(".day-cell.adjacent")[0]!
    await backCell.trigger("click")
    await nextTick()
    expect(wrapper.find(".month-grid").exists()).toBe(true)
  })
})
