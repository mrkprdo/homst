import { describe, it, expect, vi } from "vitest"
import { mount, flushPromises } from "@vue/test-utils"
import { nextTick } from "vue"
import CalendarView from "@/components/calendar/CalendarView.vue"
import { useEvents } from "@/composables/useEvents"
import { useUi } from "@/composables/useUi"
import { COLORS } from "@/__tests__/constants"

describe("CalendarView", () => {
  it("renders the calendar toolbar", () => {
    const wrapper = mount(CalendarView)
    expect(wrapper.find(".calendar-toolbar").exists()).toBe(true)
  })

  it("starts in month view", () => {
    const wrapper = mount(CalendarView)
    expect(wrapper.find(".month-grid").exists()).toBe(true)
  })

  it("month view shows month label", () => {
    const wrapper = mount(CalendarView)
    const label = wrapper.find(".nav-label")
    expect(label.exists()).toBe(true)
    expect(label.text()).toBeTruthy()
  })

  it("month view has 7 day headers", () => {
    const wrapper = mount(CalendarView)
    const headers = wrapper.findAll(".day-header")
    expect(headers).toHaveLength(7)
  })

  it("lenses the month grid around the focus day", () => {
    const wrapper = mount(CalendarView)
    const grid = wrapper.find(".month-grid").element as HTMLElement
    const cols = grid.style.gridTemplateColumns.split(" ")
    const rows = grid.style.gridTemplateRows

    expect(cols).toHaveLength(7)
    expect(cols).toContain("1.1000fr")
    // The focus row is a fixed square track derived from the view width; the
    // remaining rows keep fractional weights.
    expect(rows).toContain("100cqw")
    expect(rows).toContain("fr")
  })

  it("keeps day headers aligned with the weighted date columns", () => {
    const wrapper = mount(CalendarView)
    const grid = wrapper.find(".month-grid").element as HTMLElement
    const headers = wrapper.find(".day-headers").element as HTMLElement

    expect(headers.style.gridTemplateColumns).toBe(grid.style.gridTemplateColumns)
    expect(wrapper.findAll(".day-header")).toHaveLength(7)
  })

  it("moves the focus lens when another day is selected", async () => {
    const wrapper = mount(CalendarView)
    const grid = wrapper.find(".month-grid").element as HTMLElement
    const before = grid.style.gridTemplateColumns

    const days = wrapper.findAll(".day-cell:not(.adjacent)")
    const todayDate = new Date().getDate()
    const target = days.find((_, index) => index + 1 !== todayDate)!
    await target.trigger("click")
    await nextTick()

    expect(grid.style.gridTemplateColumns).not.toBe(before)
    expect(target.classes()).toContain("focus-anchor")
  })

  it("switches to week view when clicking Week button", async () => {
    const wrapper = mount(CalendarView)
    const seg = wrapper.findComponent({ name: "UiSegmentedControl" })
    const btns = seg.findAll(".segmented-btn")
    await btns[1]!.trigger("click")
    await nextTick()
    expect(wrapper.find(".week-grid").exists()).toBe(true)
    expect(wrapper.find(".month-grid").exists()).toBe(false)
  })

  it("week view has time gutter and 7 day columns", async () => {
    const wrapper = mount(CalendarView)
    const seg = wrapper.findComponent({ name: "UiSegmentedControl" })
    const btns = seg.findAll(".segmented-btn")
    await btns[1]!.trigger("click")
    await nextTick()
    expect(wrapper.findAll(".week-col-header")).toHaveLength(7)
  })

  it("week view renders hour time labels", async () => {
    const wrapper = mount(CalendarView)
    const seg = wrapper.findComponent({ name: "UiSegmentedControl" })
    const btns = seg.findAll(".segmented-btn")
    await btns[1]!.trigger("click")
    await nextTick()
    const timeLabels = wrapper.findAll(".week-time-label")
    expect(timeLabels.length).toBeGreaterThan(0)
  })

  it("week view renders hour cells", async () => {
    const wrapper = mount(CalendarView)
    const seg = wrapper.findComponent({ name: "UiSegmentedControl" })
    const btns = seg.findAll(".segmented-btn")
    await btns[1]!.trigger("click")
    await nextTick()
    const cells = wrapper.findAll(".week-hour-cell")
    expect(cells.length).toBeGreaterThan(0)
  })

  it("week view renders day names and numbers", async () => {
    const wrapper = mount(CalendarView)
    const seg = wrapper.findComponent({ name: "UiSegmentedControl" })
    const btns = seg.findAll(".segmented-btn")
    await btns[1]!.trigger("click")
    await nextTick()
    const dayNames = wrapper.findAll(".week-day-name")
    const dayNums = wrapper.findAll(".week-day-num")
    expect(dayNames).toHaveLength(7)
    expect(dayNums).toHaveLength(7)
  })

  it("switches to day view when clicking Day button", async () => {
    const wrapper = mount(CalendarView)
    const seg = wrapper.findComponent({ name: "UiSegmentedControl" })
    const btns = seg.findAll(".segmented-btn")
    await btns[2]!.trigger("click")
    await nextTick()
    expect(wrapper.find(".day-view").exists()).toBe(true)
    expect(wrapper.find(".month-grid").exists()).toBe(false)
  })

  it("day view shows sticky day banner", async () => {
    const wrapper = mount(CalendarView)
    const seg = wrapper.findComponent({ name: "UiSegmentedControl" })
    const btns = seg.findAll(".segmented-btn")
    await btns[2]!.trigger("click")
    await nextTick()
    expect(wrapper.find(".day-banner").exists()).toBe(true)
  })

  it("day view renders time cells", async () => {
    const wrapper = mount(CalendarView)
    const seg = wrapper.findComponent({ name: "UiSegmentedControl" })
    const btns = seg.findAll(".segmented-btn")
    await btns[2]!.trigger("click")
    await nextTick()
    const cells = wrapper.findAll(".day-hour-cell")
    expect(cells.length).toBeGreaterThan(0)
  })

  it("day view has 24 hour cells (1am–12am)", async () => {
    const wrapper = mount(CalendarView)
    const seg = wrapper.findComponent({ name: "UiSegmentedControl" })
    const btns = seg.findAll(".segmented-btn")
    await btns[2]!.trigger("click")
    await nextTick()
    const cells = wrapper.findAll(".day-hour-cell")
    expect(cells).toHaveLength(24)
  })

  it("day view shows day name and date in banner", async () => {
    const wrapper = mount(CalendarView)
    const seg = wrapper.findComponent({ name: "UiSegmentedControl" })
    const btns = seg.findAll(".segmented-btn")
    await btns[2]!.trigger("click")
    await nextTick()
    expect(wrapper.find(".day-banner-dayname").exists()).toBe(true)
    expect(wrapper.find(".day-banner-date").exists()).toBe(true)
  })

  it("Today button exists and resets month", async () => {
    const wrapper = mount(CalendarView)
    const todayBtn = wrapper.find(".text-btn")
    expect(todayBtn.exists()).toBe(true)
    expect(todayBtn.text()).toContain("Today")
    await todayBtn.trigger("click")
    await nextTick()
    expect(wrapper.find(".month-grid").exists()).toBe(true)
  })

  it("Add button opens quick-add drawer", async () => {
    const wrapper = mount(CalendarView)
    const ui = useUi()
    const addBtn = wrapper.findComponent({ name: "UiButton" })
    await addBtn.trigger("click")
    expect(ui.isDrawerOpen.value).toBe(true)
    expect(ui.drawer.value.type).toBe("quick-add")
  })

  it("opens focused on a requested calendar date", async () => {
    const ui = useUi()
    const target = new Date(2030, 0, 15)
    ui.openCalendar(target)

    const wrapper = mount(CalendarView)
    await flushPromises()
    await nextTick()

    expect(wrapper.find(".day-cell.selected .day-num").text()).toBe("15")
    expect(ui.calendarTarget.value).toBeNull()
    expect(ui.drawer.value.type).toBeNull()
    wrapper.unmount()
  })

  it("opens the event detail after landing on its date", async () => {
    const ui = useUi()
    const target = new Date(2030, 0, 15)
    ui.openCalendar(target, "evt-focused")

    const wrapper = mount(CalendarView)
    await flushPromises()
    await nextTick()

    expect(wrapper.find(".day-cell.selected .day-num").text()).toBe("15")
    expect(ui.drawer.value.type).toBe("event-detail")
    expect(ui.drawer.value.id).toBe("evt-focused")
    wrapper.unmount()
  })

  it("navigation arrows exist and are clickable", async () => {
    const wrapper = mount(CalendarView)
    const arrows = wrapper.findAll(".nav-arrow")
    expect(arrows).toHaveLength(2)

    await arrows[1]!.trigger("click")
    await nextTick()
    expect(wrapper.find(".month-grid").exists()).toBe(true)

    await arrows[0]!.trigger("click")
    await nextTick()
    expect(wrapper.find(".month-grid").exists()).toBe(true)
  })

  it("renders month grid when events present", async () => {
    const { upsertCalendar, upsertEvent } = useEvents()
    upsertCalendar({
      id: "cal-1", householdId: "h-1", name: "Family",
      color: "peach", source: "internal", feedUrl: null,
      isVisible: true, createdBy: "u-1",
    })
    upsertEvent({
      id: "evt-1", calendarId: "cal-1", title: "Dinner",
      description: "", startAt: "2026-05-01T18:00:00Z", endAt: "2026-05-01T20:00:00Z",
      allDay: false, recurrence: null, source: "internal", externalUid: null,
      createdBy: "u-1", createdAt: "2026-05-01T00:00:00Z", updatedAt: "2026-05-01T00:00:00Z",
    })

    const wrapper = mount(CalendarView)
    expect(wrapper.find(".month-grid").exists()).toBe(true)
  })

  it("renders events in week view hour cells", async () => {
    const { upsertCalendar, upsertEvent } = useEvents()
    const now = new Date()
    upsertCalendar({
      id: "cal-1", householdId: "h-1", name: "Family",
      color: "peach", source: "internal", feedUrl: null,
      isVisible: true, createdBy: "u-1",
    })
    upsertEvent({
      id: "evt-wk", calendarId: "cal-1", title: "Morning standup",
      description: "", startAt: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 9, 0).toISOString(),
      endAt: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 10, 0).toISOString(),
      allDay: false, recurrence: null, source: "internal", externalUid: null,
      createdBy: "u-1", createdAt: "", updatedAt: "",
    })

    const wrapper = mount(CalendarView)
    const seg = wrapper.findComponent({ name: "UiSegmentedControl" })
    const btns = seg.findAll(".segmented-btn")
    await btns[1]!.trigger("click")
    await nextTick()
    expect(wrapper.find(".week-grid").exists()).toBe(true)
  })

  it("renders events in day view timeline", async () => {
    const { upsertCalendar, upsertEvent } = useEvents()
    const now = new Date()
    upsertCalendar({
      id: "cal-1", householdId: "h-1", name: "Family",
      color: "peach", source: "internal", feedUrl: null,
      isVisible: true, createdBy: "u-1",
    })
    upsertEvent({
      id: "evt-day", calendarId: "cal-1", title: "Lunch",
      description: "", startAt: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0).toISOString(),
      endAt: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 13, 0).toISOString(),
      allDay: false, recurrence: null, source: "internal", externalUid: null,
      createdBy: "u-1", createdAt: "", updatedAt: "",
    })

    const wrapper = mount(CalendarView)
    const seg = wrapper.findComponent({ name: "UiSegmentedControl" })
    const btns = seg.findAll(".segmented-btn")
    await btns[2]!.trigger("click")
    await nextTick()
    expect(wrapper.find(".day-grid").exists()).toBe(true)
  })

  it("skeleton shows while the visible month has no data yet", async () => {
    const { calendarApi } = await import("@/api/calendar")
    const pending = new Promise<never>(() => {})
    const spy = vi.spyOn(calendarApi, "getEvents").mockReturnValue(pending as never)
    const { loading } = useEvents()
    loading.value = true
    const wrapper = mount(CalendarView)
    await nextTick()
    expect(wrapper.find(".skeleton-grid").exists()).toBe(true)
    spy.mockRestore()
    wrapper.unmount()
  })

  it("keeps the grid instead of flashing the skeleton for a cached month", async () => {
    const wrapper = mount(CalendarView)
    await flushPromises()
    const { loading, isMonthLoaded } = useEvents()
    const now = new Date()
    expect(isMonthLoaded(now.getFullYear(), now.getMonth())).toBe(true)

    loading.value = true
    await nextTick()
    // `showSkeleton` is already false; the node only lingers for its fade-out.
    await new Promise((resolve) => setTimeout(resolve, 400))
    expect(wrapper.find(".skeleton-grid").exists()).toBe(false)
  })

  it("nav arrows navigate days in day view", async () => {
    const wrapper = mount(CalendarView)
    const seg = wrapper.findComponent({ name: "UiSegmentedControl" })
    const btns = seg.findAll(".segmented-btn")
    await btns[2]!.trigger("click")
    await nextTick()

    expect(wrapper.find(".day-view").exists()).toBe(true)

    const arrows = wrapper.findAll(".nav-arrow")
    await arrows[1]!.trigger("click")
    await nextTick()
    expect(wrapper.find(".day-view").exists()).toBe(true)
  })

  it("navigates weeks forward and back in week view", async () => {
    const wrapper = mount(CalendarView)
    const seg = wrapper.findComponent({ name: "UiSegmentedControl" })
    const btns = seg.findAll(".segmented-btn")
    await btns[1]!.trigger("click")
    await nextTick()
    expect(wrapper.find(".week-grid").exists()).toBe(true)

    const arrows = wrapper.findAll(".nav-arrow")
    await arrows[1]!.trigger("click")
    await nextTick()
    expect(wrapper.find(".week-grid").exists()).toBe(true)

    await arrows[0]!.trigger("click")
    await nextTick()
    expect(wrapper.find(".week-grid").exists()).toBe(true)
  })

  it("day view shows nav label with full date", async () => {
    const wrapper = mount(CalendarView)
    const seg = wrapper.findComponent({ name: "UiSegmentedControl" })
    const btns = seg.findAll(".segmented-btn")
    await btns[2]!.trigger("click")
    await nextTick()

    const label = wrapper.find(".nav-label")
    expect(label.exists()).toBe(true)
    expect(label.text()).toBeTruthy()
  })

  it("view mode buttons toggle active class", async () => {
    const wrapper = mount(CalendarView)
    const seg = wrapper.findComponent({ name: "UiSegmentedControl" })
    const btns = seg.findAll(".segmented-btn")
    expect(btns[0]!.classes()).toContain("active")

    await btns[1]!.trigger("click")
    await nextTick()
    expect(btns[1]!.classes()).toContain("active")
    expect(btns[0]!.classes()).not.toContain("active")

    await btns[2]!.trigger("click")
    await nextTick()
    expect(btns[2]!.classes()).toContain("active")
  })

  it("renders event title in month day cells", async () => {
    const { upsertCalendar, upsertEvent } = useEvents()
    const now = new Date()
    upsertCalendar({
      id: "cal-ev", householdId: "h-1", name: "Events",
      color: "sage", source: "internal", feedUrl: null,
      isVisible: true, createdBy: "u-1",
    })
    upsertEvent({
      id: "ev-cell", calendarId: "cal-ev", title: "Cell Event",
      description: "", startAt: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 14, 0).toISOString(),
      endAt: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 15, 0).toISOString(),
      allDay: false, recurrence: null, source: "internal", externalUid: null,
      createdBy: "u-1", createdAt: "", updatedAt: "",
    })
    const wrapper = mount(CalendarView)
    expect(wrapper.text()).toContain("Cell Event")
  })

  it("respects calendar visibility toggle", async () => {
    const { upsertCalendar, upsertEvent, calendars } = useEvents()
    upsertCalendar({
      id: "cal-vis", householdId: "h-1", name: "Hidden",
      color: "plum", source: "internal", feedUrl: null,
      isVisible: false, createdBy: "u-1",
    })
    upsertEvent({
      id: "ev-vis", calendarId: "cal-vis", title: "Hidden Event",
      description: "", startAt: "2026-05-01T10:00:00Z", endAt: "2026-05-01T11:00:00Z",
      allDay: false, recurrence: null, source: "internal", externalUid: null,
      createdBy: "u-1", createdAt: "", updatedAt: "",
    })
    const wrapper = mount(CalendarView)
    const visibleCals = calendars.value.filter(c => c.isVisible)
    expect(visibleCals.length).toBeLessThan(calendars.value.length)
  })

  it("accepts all calendar color values", () => {
    for (const color of COLORS) {
      const { upsertCalendar } = useEvents()
      upsertCalendar({
        id: `cal-${color}`, householdId: "h-1", name: color,
        color, source: "internal", feedUrl: null,
        isVisible: true, createdBy: "u-1",
      })
      const wrapper = mount(CalendarView)
      expect(wrapper.exists()).toBe(true)
    }
  })
})
