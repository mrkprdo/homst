import { describe, it, expect, vi, beforeEach } from "vitest"
import { nextTick } from "vue"
import { mount, flushPromises } from "@vue/test-utils"
import { setLowPower } from "@/lib/motion"
import { useEvents } from "@/composables/useEvents"
import { useTasks } from "@/composables/useTasks"
import { useMembers } from "@/composables/useMembers"
import { useSettings } from "@/composables/useSettings"
import MobileShell from "@/components/mobile/MobileShell.vue"
import MobileCalendarView from "@/components/mobile/MobileCalendarView.vue"
import MobileTasksView from "@/components/mobile/MobileTasksView.vue"
import MobileProfile from "@/components/mobile/MobileProfile.vue"
import MobileQuickAdd from "@/components/mobile/MobileQuickAdd.vue"
import MobileAnnouncements from "@/components/mobile/MobileAnnouncements.vue"
import { useUi } from "@/composables/useUi"

beforeEach(() => {
  setLowPower(true)
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn().mockReturnValue({ matches: false }),
  })
})

describe("MobileShell", () => {
  it("renders events & tasks views, install banner, detail sheets, quick-add & profile", async () => {
    const ev = useEvents()
    const tk = useTasks()
    const mb = useMembers()

    mb.upsertMember({
      id: "m1", householdId: "h", name: "Alice", avatarUrl: null,
      color: "sage", role: "admin", joinedAt: "",
    })
    const today = new Date()
    today.setHours(12, 0, 0, 0)
    const start = today.toISOString()
    ev.upsertEvent({
      id: "e1", calendarId: "c1", title: "Today Event", description: "",
      startAt: start, endAt: null, allDay: true, recurrence: null,
      assigneeId: "m1", source: "internal", externalUid: null, createdBy: null,
      createdAt: "", updatedAt: "",
    })
    tk.upsertTask({
      id: "t1", listId: "l1", title: "Buy milk", description: "",
      assigneeId: "m1", startAt: start, endAt: null,
      status: "todo", priority: "high", position: 0,
      createdBy: null, createdAt: "", updatedAt: "",
    })

    const w = mount(MobileShell)
    await flushPromises()

    // Trigger beforeinstallprompt event + installApp
    const promptEvt = new Event("beforeinstallprompt") as any
    promptEvt.prompt = vi.fn()
    promptEvt.userChoice = Promise.resolve({ outcome: "accepted" })
    window.dispatchEvent(promptEvt)
    await nextTick()
    const installBtn = w.find(".ms-install-action")
    if (installBtn.exists()) await installBtn.trigger("click")
    await flushPromises()

    // Click event item → opens EventDetailPanel sheet → close
    await w.find(".mc-event").trigger("click")
    expect(w.find(".ms-detail-overlay").exists()).toBe(true)
    await w.find(".ms-detail-close").trigger("click")
    expect(w.find(".ms-detail-overlay").exists()).toBe(false)

    // Switch to Tasks tab → click task item → opens TaskDetailPanel sheet → close
    const tabs = w.findAll(".ms-tab")
    await tabs[1]!.trigger("click")
    expect(w.text()).toContain("Buy milk")
    await w.find(".mt-item").trigger("click")
    expect(w.find(".ms-detail-overlay").exists()).toBe(true)
    await w.find(".ms-detail-close").trigger("click")

    // Profile & QuickAdd modals
    await w.find(".ms-profile-btn").trigger("click")
    expect(w.findComponent(MobileProfile).exists()).toBe(true)
    w.findComponent(MobileProfile).vm.$emit("close")
    await nextTick()

    await w.find(".ms-fab").trigger("click")
    expect(w.findComponent(MobileQuickAdd).exists()).toBe(true)
    w.findComponent(MobileQuickAdd).vm.$emit("close")
    await nextTick()

    // Announcement sheet opens from the app bar.
    await w.find(".ms-announce-btn").trigger("click")
    expect(w.findComponent(MobileAnnouncements).exists()).toBe(true)
    w.findComponent(MobileAnnouncements).vm.$emit("close")
    await nextTick()
    expect(useUi().announcementsOpen.value).toBe(false)
  })

  it("opens notification intents from shared UI state", async () => {
    const ui = useUi()
    const w = mount(MobileShell)
    await flushPromises()

    ui.openAnnouncements()
    await nextTick()
    expect(w.findComponent(MobileAnnouncements).exists()).toBe(true)
    w.findComponent(MobileAnnouncements).vm.$emit("close")
    await nextTick()
    expect(ui.announcementsOpen.value).toBe(false)

    ui.openDrawer("event-detail", "e1")
    await nextTick()
    expect(w.find(".ms-detail-overlay").exists()).toBe(true)
    await w.find(".ms-detail-close").trigger("click")
    await nextTick()
    expect(w.find(".ms-detail-overlay").exists()).toBe(false)
  })
})

describe("MobileCalendarView", () => {
  it("renders week strip, navigates weeks/today, selects day, and emits selectEvent for timed & all-day events", async () => {
    const ev = useEvents()
    const mb = useMembers()
    mb.upsertMember({
      id: "m1", householdId: "h", name: "Alice", avatarUrl: null,
      color: "peach", role: "admin", joinedAt: "",
    })
    const todayIso = new Date().toISOString()
    ev.upsertEvent({
      id: "e-all", calendarId: "c1", title: "AllDayEv", description: "",
      startAt: todayIso, endAt: todayIso, allDay: true, recurrence: null,
      assigneeId: "m1", source: "internal", externalUid: null, createdBy: null,
      createdAt: "", updatedAt: "",
    })
    ev.upsertEvent({
      id: "e-timed", calendarId: "c1", title: "TimedEv", description: "",
      startAt: todayIso, endAt: null, allDay: false, recurrence: null,
      source: "internal", externalUid: null, createdBy: null,
      createdAt: "", updatedAt: "",
    })

    const w = mount(MobileCalendarView)
    await flushPromises()
    expect(w.text()).toContain("AllDayEv")
    expect(w.text()).toContain("TimedEv")

    await w.find(".mc-event--allday").trigger("click")
    await w.findAll(".mc-event")[1]!.trigger("click")
    expect(w.emitted("selectEvent")).toHaveLength(2)

    const navBtns = w.findAll(".mc-nav-btn")
    await navBtns[0]!.trigger("click") // prevWeek
    await navBtns[1]!.trigger("click") // nextWeek
    await w.find(".mc-today-chip").trigger("click") // goToToday
    const dayBtns = w.findAll(".mc-day-btn")
    await dayBtns[0]!.trigger("click")
  })
})

describe("MobileTasksView", () => {
  it("renders todo/doing/done sections, toggles collapse, and emits selectTask", async () => {
    const tk = useTasks()
    const mb = useMembers()
    mb.upsertMember({
      id: "m1", householdId: "h", name: "Alice", avatarUrl: null,
      color: "#b1b695", role: "admin", joinedAt: "",
    })
    tk.upsertTask({
      id: "t1", listId: "l1", title: "T-todo", description: "",
      assigneeId: "m1", startAt: null, endAt: null,
      status: "todo", priority: "high", position: 0,
      createdBy: null, createdAt: "", updatedAt: "",
    })
    tk.upsertTask({
      id: "t2", listId: "l1", title: "T-doing", description: "",
      assigneeId: null, startAt: null, endAt: null,
      status: "doing", priority: "medium", position: 0,
      createdBy: null, createdAt: "", updatedAt: "",
    })
    tk.upsertTask({
      id: "t3", listId: "l1", title: "T-done", description: "",
      assigneeId: null, startAt: null, endAt: null,
      status: "done", priority: "low", position: 0,
      createdBy: null, createdAt: "", updatedAt: "",
    })

    const w = mount(MobileTasksView)
    await flushPromises()

    // Open Done section (starts closed)
    const headers = w.findAll(".mt-section-header")
    await headers[2]!.trigger("click")
    expect(w.text()).toContain("T-done")

    const items = w.findAll(".mt-item")
    await items[0]!.trigger("click")
    await items[2]!.trigger("click")
    expect(w.emitted("selectTask")?.map(e => e[0])).toEqual(["t1", "t3"])

    // Collapse todo & doing
    await headers[0]!.trigger("click")
    await headers[1]!.trigger("click")
  })
})

describe("MobileProfile", () => {
  it("renders empty state and populated member list with admin badge, and emits close", async () => {
    const wEmpty = mount(MobileProfile)
    await flushPromises()
    expect(wEmpty.text()).toContain("No member info")

    const mb = useMembers()
    mb.upsertMember({
      id: "m1", householdId: "h", name: "Alice", avatarUrl: null,
      color: "sage-base", role: "admin", joinedAt: "2026-01-15T00:00:00Z",
    })
    const w = mount(MobileProfile)
    await flushPromises()
    expect(w.text()).toContain("Alice")
    expect(w.text()).toContain("Admin")
    expect(w.text()).toContain("Joined")

    await w.find(".mp-close").trigger("click")
    expect(w.emitted("close")).toBeTruthy()
  })

  it("lets the phone enable push, fire a test at all clients, and download the CA", async () => {
    const w = mount(MobileProfile)
    await flushPromises()

    // Push is unsupported in jsdom → the subscription toggle is disabled…
    expect(w.find(".ui-toggle").attributes("disabled")).toBeDefined()
    // …but the global test still fires (screens + any subscribed phones).
    expect(w.find(".mp-test-btn").attributes("disabled")).toBeUndefined()
    expect(w.text()).toContain("Notifications")
    expect(w.text()).toContain("HTTPS certificate")
    expect(w.find('a[href="/ca.pem"]').exists()).toBe(true)

    await w.find(".mp-test-btn").trigger("click")
    await flushPromises()

    const call = vi.mocked(fetch).mock.calls.find(c => String(c[0]).includes("/notifications/test"))
    expect(call).toBeTruthy()
    expect(JSON.parse((call![1] as RequestInit).body as string)).toEqual({ channels: ["hud", "push"] })
  })
})

describe("MobileQuickAdd", () => {
  it("creates timed/all-day/recurring events with duration chips and creates tasks (auto-creating General list)", async () => {
    vi.useFakeTimers()
    try {
      const mb = useMembers()
      const settings = useSettings()
      settings.updateDefaultReminderMinutes(10)
      mb.upsertMember({
        id: "m1", householdId: "h", name: "Alice", avatarUrl: null,
        color: "#b1b695", role: "admin", joinedAt: "",
      })

      const w = mount(MobileQuickAdd)
      await flushPromises()

      // Fill event title, apply duration chip, set recurrence + count, submit
      await w.find('input[placeholder="Event title"]').setValue("Party")
      const durChips = w.findAll(".mqa-duration-chip")
      await durChips[1]!.trigger("click") // 30m

      const selects = w.findAll("select")
      await selects[1]!.setValue("weekly")
      await nextTick()
      // Assigned to · Repeat · End repeat · Remind me
      const allSelects = w.findAll("select")
      await allSelects[2]!.setValue("count")
      await nextTick()

      await w.find(".mqa-submit").trigger("click")
      await vi.waitFor(() => {
        expect(useEvents().events.value.some(e => e.title === "Party")).toBe(true)
      })
      vi.advanceTimersByTime(900)

      // Switch to Task tab, create task when no list exists (creates General list first)
      const tabs = w.findAll(".mqa-tab")
      await tabs[1]!.trigger("click")
      await w.find('input[placeholder="Task title"]').setValue("Vacuum")
      const prioBtns = w.findAll(".mqa-priority-btn")
      await prioBtns[2]!.trigger("click") // high

      vi.mocked(fetch).mockImplementation(async (url, opts) => {
        const u = String(url)
        if (u.includes("/task-lists") && opts?.method === "POST") {
          return new Response(JSON.stringify({
            id: "l-gen", household_id: "h", name: "General", color: "#948f8f", position: 0,
          }), { status: 201 })
        }
        if (u.includes("/tasks") && opts?.method === "POST") {
          return new Response(JSON.stringify({
            id: "t-new", list_id: "l-gen", title: "Vacuum", description: "",
            assignee_id: null, start_at: null, end_at: null,
            status: "todo", priority: "high", position: 0,
            created_by: null, created_at: "", updated_at: "",
          }), { status: 201 })
        }
        return new Response(JSON.stringify([]), { status: 200 })
      })

      await w.find(".mqa-submit").trigger("click")
      await vi.waitFor(() => {
        expect(useTasks().tasks.value.some(t => t.title === "Vacuum")).toBe(true)
      })
      vi.advanceTimersByTime(900)
    } finally {
      vi.useRealTimers()
    }
  })
})
