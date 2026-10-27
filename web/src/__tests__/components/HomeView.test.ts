import { describe, it, expect, vi, beforeEach } from "vitest"
import { nextTick } from "vue"
import { mount, flushPromises } from "@vue/test-utils"
import { setLowPower } from "@/lib/motion"
import { useEvents } from "@/composables/useEvents"
import { useTasks } from "@/composables/useTasks"
import { useMembers } from "@/composables/useMembers"
import { useSettings } from "@/composables/useSettings"
import { useWeather } from "@/composables/useWeather"
import { useSpotify } from "@/composables/useSpotify"
import { useUi } from "@/composables/useUi"
import HomeView from "@/components/home/HomeView.vue"

const _ls = new Map<string, string>()
const _memLs: Storage = {
  get length() { return _ls.size },
  clear: () => _ls.clear(),
  getItem: (k: string) => _ls.get(k) ?? null,
  key: (i: number) => Array.from(_ls.keys())[i] ?? null,
  removeItem: (k: string) => { _ls.delete(k) },
  setItem: (k: string, v: string) => { _ls.set(k, String(v)) },
}
Object.defineProperty(window, "localStorage", { configurable: true, value: _memLs })
Object.defineProperty(globalThis, "localStorage", { configurable: true, value: _memLs })

describe("HomeView", () => {
  beforeEach(() => {
    setLowPower(true)
    localStorage.clear()
  })

  it("renders widgets, time-derived photo slideshow, weather icons, spotify states, and handles lock/drag/resize", async () => {
    vi.useFakeTimers()
    // Keep today's date (HomeView captures `today = ref(new Date())` at import time)
    // while aligning to a multiple of 15_000ms so floor(now / 5000) % 3 === 0
    const baseMs = Math.floor(Date.now() / 15_000) * 15_000
    vi.setSystemTime(baseMs)
    try {
      const ev = useEvents()
      const tk = useTasks()
      const mb = useMembers()
      const settings = useSettings()
      const w = useWeather()
      const sp = useSpotify()
      const ui = useUi()

      mb.upsertMember({
        id: "m1", householdId: "h", name: "Alice", avatarUrl: null,
        color: "#b1b695", role: "admin", joinedAt: "",
      })
      const todayIso = new Date(baseMs).toISOString()
      ev.upsertEvent({
        id: "e1", calendarId: "c1", title: "Lunch", description: "",
        startAt: todayIso, endAt: null, allDay: false, recurrence: null,
        assigneeId: "m1", source: "internal", externalUid: null, createdBy: null,
        createdAt: "", updatedAt: "",
      })
      tk.upsertTask({
        id: "t1", listId: "l1", title: "TodoTask", description: "",
        assigneeId: "m1", startAt: "2026-05-10T00:00:00Z", endAt: null,
        status: "todo", priority: "high", position: 0,
        createdBy: null, createdAt: "", updatedAt: "",
      })
      tk.upsertTask({
        id: "t2", listId: "l1", title: "DoingTask", description: "",
        assigneeId: null, startAt: null, endAt: null,
        status: "doing", priority: "medium", position: 0,
        createdBy: null, createdAt: "", updatedAt: "",
      })

      // Seed 3 selected photos + 1 unselected
      settings.photos.value = [
        { id: "p1", url: "/p1.jpg", selected: true },
        { id: "p2", url: "/p2.jpg", selected: true },
        { id: "p3", url: "/p3.jpg", selected: true },
        { id: "p4", url: "/p4.jpg", selected: false },
      ]

      // Mock household settings response with partial layout (missing spotify & photos → findFreeSlot)
      vi.mocked(fetch).mockImplementation(async (url) => {
        const u = String(url)
        if (u.includes("/household/settings")) {
          return new Response(JSON.stringify({
            houseName: "Cedar Home",
            widgetLayout: [
              { id: "datetime", col: 0, row: 0, w: 1, h: 1 },
              { id: "weather",  col: 1, row: 0, w: 1, h: 1 },
              { id: "schedule", col: 2, row: 0, w: 1, h: 1 },
              { id: "todos",    col: 3, row: 0, w: 1, h: 1 },
              { id: "calendar", col: 0, row: 1, w: 2, h: 2 },
            ],
          }), { status: 200 })
        }
        return new Response(JSON.stringify([]), { status: 200 })
      })

      const wrapper = mount(HomeView, {
        global: { stubs: { Transition: false } },
      })
      await flushPromises()
      await nextTick()

      expect(wrapper.text()).toContain("Cedar Home")
      expect(wrapper.text()).toContain("Lunch")
      expect(wrapper.text()).toContain("TodoTask")
      expect(wrapper.text()).toContain("DoingTask")

      // Photo slideshow: at baseMs (multiple of 15000), floor(baseMs/5000)%3 === 0 → /p1.jpg
      expect(wrapper.find(".photos-img").attributes("src")).toBe("/p1.jpg")
      // Advance 5000ms → photoTimer (500ms interval) updates slideshowNow → floor((baseMs+5000)/5000)%3 === 1 → /p2.jpg
      await vi.advanceTimersByTimeAsync(5000)
      await nextTick()
      expect(wrapper.findAll(".photos-img").at(-1)?.attributes("src")).toBe("/p2.jpg")

      // Weather codes coverage (0, 2, 45, 61, 71, 80, 95)
      for (const code of [0, 2, 45, 61, 71, 80, 95]) {
        w.weather.value = {
          temp: 20, feelsLike: 19, high: 24, low: 12, code,
          humidity: 50, windSpeed: 10, location: "City", lat: 43.65, lon: -79.38,
        }
        w.loading.value = false
        w.error.value = null
        await nextTick()
      }
      expect(wrapper.text()).toContain("City")

      // Spotify setup → submit client ID, then simulate playing track
      const spInput = wrapper.find(".spotify-setup-input")
      if (spInput.exists()) {
        await spInput.setValue("0123456789abcdef0123456789abcdef")
        await wrapper.find(".spotify-connect-btn").trigger("click")
      }
      sp.connected.value = true
      sp.currentTrack.value = {
        id: "tr", name: "My Track", artists: "Artist", albumArt: "/art.jpg",
        progressMs: 30_000, durationMs: 60_000, isPlaying: true,
      }
      await nextTick()
      expect(wrapper.text()).toContain("My Track")

      // Unlock edit mode, drag & resize a widget, then lock again
      await wrapper.find(".lock-toggle").trigger("click")
      expect(wrapper.findAll(".drag-handle").length).toBeGreaterThan(0)

      const dragHandle = wrapper.find(".drag-handle")
      dragHandle.element.dispatchEvent(new MouseEvent("pointerdown", { clientX: 10, clientY: 10, bubbles: true }))
      window.dispatchEvent(new MouseEvent("pointermove", { clientX: 250, clientY: 250 }))
      window.dispatchEvent(new MouseEvent("pointerup"))

      const resizeHandle = wrapper.find(".resize-handle")
      resizeHandle.element.dispatchEvent(new MouseEvent("pointerdown", { clientX: 10, clientY: 10, bubbles: true }))
      window.dispatchEvent(new MouseEvent("pointermove", { clientX: 250, clientY: 250 }))
      window.dispatchEvent(new MouseEvent("pointerup"))

      // Dispatch custom layout event
      window.dispatchEvent(new CustomEvent("homst:widget-layout-updated", { detail: [] }))

      // Mini-calendar day click jumps to the calendar on that date
      const dayBtn = wrapper.find(".mini-cal-day:not(.mini-cal-day--empty)")
      const clickedDay = Number(dayBtn.find(".mini-cal-day__num").text())
      await dayBtn.trigger("click")
      expect(ui.activePanel.value).toBe("calendar")
      expect(new Date(ui.calendarTarget.value!.date).getDate()).toBe(clickedDay)
      expect(ui.calendarTarget.value!.eventId).toBeUndefined()

      wrapper.unmount()
    } finally {
      vi.useRealTimers()
    }
  })

  it("navigates schedule days and returns to today after two minutes or a screen change", async () => {
    vi.useFakeTimers()
    const base = Math.floor(Date.now() / 60_000) * 60_000
    vi.setSystemTime(base)
    try {
      vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }))
      const ev = useEvents()
      const ui = useUi()
      ui.setPanel("home")

      const tomorrow = new Date(base)
      tomorrow.setDate(tomorrow.getDate() + 1)
      tomorrow.setHours(12, 0, 0, 0)
      const tomorrowEnd = new Date(tomorrow)
      tomorrowEnd.setHours(13)
      ev.upsertEvent({
        id: "schedule-tomorrow", calendarId: "c1", title: "Tomorrow event", description: "",
        startAt: tomorrow.toISOString(), endAt: tomorrowEnd.toISOString(), allDay: false, recurrence: null,
        source: "internal", externalUid: null, createdBy: null, createdAt: "", updatedAt: "",
      })

      const wrapper = mount(HomeView)
      await flushPromises()
      await nextTick()

      const prev = wrapper.find('[aria-label="Previous day"]')
      const next = wrapper.find('[aria-label="Next day"]')
      const scheduleText = () =>
        wrapper.find(".schedule-list").exists() ? wrapper.find(".schedule-list").text() : ""
      expect(prev.exists()).toBe(true)
      expect(next.exists()).toBe(true)
      expect(wrapper.find(".schedule-nav__label").text()).toBe("Today")
      expect(wrapper.text()).toContain("Today's Schedule")
      expect(scheduleText()).not.toContain("Tomorrow event")

      await prev.trigger("click")
      await nextTick()
      expect(wrapper.text()).toContain("Yesterday's Schedule")

      await next.trigger("click")
      await next.trigger("click")
      await nextTick()
      expect(wrapper.text()).toContain("Tomorrow's Schedule")
      expect(scheduleText()).toContain("Tomorrow event")

      // Keep going to any date, not just tomorrow.
      await next.trigger("click")
      await nextTick()
      const inTwoDays = new Date(base)
      inTwoDays.setDate(inTwoDays.getDate() + 2)
      expect(wrapper.find(".schedule-nav__label").text())
        .toBe(inTwoDays.toLocaleDateString("en-US", { weekday: "long" }))
      expect(wrapper.find(".schedule-nav__date").text())
        .toBe(inTwoDays.toLocaleDateString("en-US", { month: "short", day: "numeric" }))

      // Stays put while the two-minute window is open…
      await vi.advanceTimersByTimeAsync(119_000)
      await nextTick()
      expect(wrapper.text()).not.toContain("Today's Schedule")

      // …then falls back to Today.
      await vi.advanceTimersByTimeAsync(1_000)
      await nextTick()
      expect(wrapper.text()).toContain("Today's Schedule")
      expect(scheduleText()).not.toContain("Tomorrow event")

      // Leaving the home screen resets the picker as well.
      await next.trigger("click")
      await nextTick()
      expect(wrapper.text()).toContain("Tomorrow's Schedule")
      ui.setPanel("calendar")
      await nextTick()
      expect(wrapper.text()).toContain("Today's Schedule")

      ui.setPanel("home")
      wrapper.unmount()
    } finally {
      vi.useRealTimers()
    }
  })

  it("navigates the mini calendar by month and previews event titles", async () => {
    vi.useFakeTimers()
    const base = Math.floor(Date.now() / 60_000) * 60_000
    vi.setSystemTime(base)
    try {
      vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }))
      const ev = useEvents()
      const eventDate = new Date(base)
      eventDate.setHours(12, 0, 0, 0)
      const eventEnd = new Date(eventDate)
      eventEnd.setHours(13)
      ev.upsertEvent({
        id: "mini-calendar-event", calendarId: "c1", title: "Mini calendar event", description: "",
        startAt: eventDate.toISOString(), endAt: eventEnd.toISOString(), allDay: false, recurrence: null,
        source: "internal", externalUid: null, createdBy: null, createdAt: "", updatedAt: "",
      })

      const wrapper = mount(HomeView)
      await flushPromises()
      await nextTick()

      const monthLabel = () => wrapper.find(".calendar-month-nav__label")
      const current = new Date(base)
      const currentMonth = current.toLocaleString("en-US", { month: "long", year: "numeric" })
      expect(monthLabel().text()).toBe(currentMonth)
      expect(wrapper.findAll(".mini-cal-chip").map(chip => chip.text())).toContain("Mini calendar event")
      expect(wrapper.findAll(".event-dot").length).toBeGreaterThan(0)

      await wrapper.find('[aria-label="Next month"]').trigger("click")
      await nextTick()
      const next = new Date(base)
      next.setDate(1)
      next.setMonth(next.getMonth() + 1)
      expect(monthLabel().text()).toBe(next.toLocaleString("en-US", { month: "long", year: "numeric" }))

      await wrapper.find('[aria-label="Previous month"]').trigger("click")
      await nextTick()
      expect(monthLabel().text()).toBe(currentMonth)

      await wrapper.find('[aria-label="Previous month"]').trigger("click")
      await nextTick()
      const previous = new Date(base)
      previous.setDate(1)
      previous.setMonth(previous.getMonth() - 1)
      expect(monthLabel().text()).toBe(previous.toLocaleString("en-US", { month: "long", year: "numeric" }))

      // The month title is the shortcut back to the live month.
      await monthLabel().trigger("click")
      await nextTick()
      expect(monthLabel().text()).toBe(currentMonth)

      wrapper.unmount()
    } finally {
      vi.useRealTimers()
    }
  })

  it("links a schedule event to its calendar date and detail", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }))
    const ev = useEvents()
    const ui = useUi()
    const start = new Date()
    start.setHours(15, 0, 0, 0)
    const end = new Date(start)
    end.setHours(16)
    ev.upsertEvent({
      id: "linked-event", calendarId: "c1", title: "Linked event", description: "",
      startAt: start.toISOString(), endAt: end.toISOString(), allDay: false, recurrence: null,
      source: "internal", externalUid: null, createdBy: null, createdAt: "", updatedAt: "",
    })

    const wrapper = mount(HomeView)
    await flushPromises()
    await nextTick()

    const row = wrapper.findAll(".schedule-row").find(r => r.text().includes("Linked event"))
    expect(row).toBeTruthy()
    await row!.trigger("click")

    expect(ui.activePanel.value).toBe("calendar")
    expect(ui.calendarTarget.value?.eventId).toBe("linked-event")
    expect(new Date(ui.calendarTarget.value!.date).toDateString()).toBe(start.toDateString())
    wrapper.unmount()
  })

  const LEGACY_LAYOUT = [
    { id: "datetime", col: 0, row: 0, w: 2, h: 1 },
    { id: "weather",  col: 2, row: 0, w: 2, h: 1 },
    { id: "schedule", col: 0, row: 1, w: 1, h: 1 },
    { id: "todos",    col: 1, row: 1, w: 1, h: 1 },
    { id: "spotify",  col: 2, row: 1, w: 2, h: 2 },
    { id: "calendar", col: 0, row: 2, w: 4, h: 2 },
    { id: "photos",   col: 0, row: 4, w: 4, h: 1 },
  ]

  function widgetWith(selector: string) {
    return (wrapper: ReturnType<typeof mount>) =>
      wrapper.findAll(".widget").find(w => w.find(selector).exists())
  }
  const spotifyWidget = widgetWith(".spotify-card")
  const calendarWidget = widgetWith(".mini-cal")

  function settingsPatch() {
    return vi.mocked(fetch).mock.calls.find(c =>
      String(c[0]).includes("/household/settings") &&
      (c[1] as RequestInit | undefined)?.method === "PATCH",
    )
  }

  it("migrates the legacy overlapping default layout and persists the fix", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }))
    const wrapper = mount(HomeView)
    await flushPromises()

    window.dispatchEvent(new CustomEvent("homst:widget-layout-updated", { detail: LEGACY_LAYOUT }))
    await flushPromises()

    // Spotify no longer covers the full-width calendar below it
    expect(spotifyWidget(wrapper)!.attributes("style")).toContain("grid-row: 1 / span 2")
    expect(spotifyWidget(wrapper)!.attributes("style")).toContain("grid-column: 5 / span 1")
    expect(calendarWidget(wrapper)!.attributes("style")).toContain("grid-column: 1 / span 2")
    expect(calendarWidget(wrapper)!.attributes("style")).toContain("grid-row: 1 / span 3")

    // The corrected layout is written back so the kiosk keeps it
    const patch = settingsPatch()
    expect(patch).toBeTruthy()
    const body = JSON.parse((patch![1] as RequestInit).body as string)
    const spotify = body.settings.widgetLayout.find((w: any) => w.id === "spotify")
    expect(spotify.h).toBe(2)
    wrapper.unmount()
  })

  it("leaves a hand-arranged layout untouched", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }))
    const wrapper = mount(HomeView)
    await flushPromises()

    const custom = [
      { id: "datetime", col: 0, row: 0, w: 1, h: 1 },
      { id: "weather",  col: 1, row: 0, w: 1, h: 1 },
      { id: "schedule", col: 2, row: 0, w: 1, h: 1 },
      { id: "todos",    col: 3, row: 0, w: 1, h: 1 },
      { id: "spotify",  col: 0, row: 1, w: 2, h: 2 },
      { id: "calendar", col: 2, row: 1, w: 2, h: 2 },
      { id: "photos",   col: 0, row: 4, w: 4, h: 1 },
    ]
    window.dispatchEvent(new CustomEvent("homst:widget-layout-updated", { detail: custom }))
    await flushPromises()

    expect(spotifyWidget(wrapper)!.attributes("style")).toContain("grid-row: 2 / span 2")
    expect(settingsPatch()).toBeFalsy()
    wrapper.unmount()
  })
})
