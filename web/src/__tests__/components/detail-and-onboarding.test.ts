import { describe, it, expect, vi, beforeEach } from "vitest"
import { nextTick } from "vue"
import { mount, flushPromises } from "@vue/test-utils"
import { setLowPower } from "@/lib/motion"
import { useEvents } from "@/composables/useEvents"
import { useTasks } from "@/composables/useTasks"
import { useMembers } from "@/composables/useMembers"
import { useUi } from "@/composables/useUi"
import router, { invalidateSettings } from "@/router"
import { HOUSEHOLD_COMPLETE_KEY } from "@/lib/householdCache"
import EventDetailPanel from "@/components/events/EventDetailPanel.vue"
import TaskDetailPanel from "@/components/tasks/TaskDetailPanel.vue"
import OnboardingWizard from "@/components/onboarding/OnboardingWizard.vue"
import MobileOnboardingGate from "@/components/mobile/MobileOnboardingGate.vue"

describe("EventDetailPanel", () => {
  beforeEach(() => {
    setLowPower(true)
  })

  it("renders empty state when event is missing", () => {
    const w = mount(EventDetailPanel)
    expect(w.text()).toContain("Event not found")
  })

  it("renders timed, all-day, multi-day, recurring, reminder, assigned & external events; edits and deletes", async () => {
    const ev = useEvents()
    const mb = useMembers()
    const ui = useUi()

    mb.upsertMember({
      id: "m1", householdId: "h", name: "Alice", avatarUrl: null,
      color: "#b1b695", role: "admin", joinedAt: "",
    })

    // Timed event with recurrence until + reminder + assignee + description
    ev.upsertEvent({
      id: "e1", calendarId: "c1", title: "Dentist", description: "Bring card",
      startAt: "2026-05-15T10:00:00Z", endAt: "2026-05-16T11:00:00Z",
      allDay: false, recurrence: { freq: "weekly", until: "2026-06-01T00:00:00Z" },
      reminderMinutes: 30, assigneeId: "m1",
      source: "internal", externalUid: null, createdBy: null,
      createdAt: "", updatedAt: "",
    })

    ui.openDrawer("event-detail", "e1")
    await nextTick()

    const w = mount(EventDetailPanel)
    expect(w.text()).toContain("Dentist")
    expect(w.text()).toContain("Weekly")
    expect(w.text()).toContain("Reminder 30 minutes before")
    expect(w.text()).toContain("Alice")
    expect(w.text()).toContain("Bring card")

    // Start edit → recurrence until branch populated
    const editBtn = w.findAll("button").find(b => b.text().includes("Edit"))!
    await editBtn.trigger("click")
    expect(w.find(".edp-form").exists()).toBe(true)

    // Toggle allDay true then false to exercise watch(editAllDay)
    const toggle = w.findComponent({ name: "UiToggle" })
    await toggle.vm.$emit("update:modelValue", true)
    await nextTick()
    await toggle.vm.$emit("update:modelValue", false)
    await nextTick()

    // Invalid time range (end <= start) shows editTimeError
    const dateInputs = w.findAll('input[type="datetime-local"]')
    await dateInputs[0]!.setValue("2026-05-20T12:00")
    await dateInputs[1]!.setValue("2026-05-20T10:00")
    await nextTick()
    expect(w.text()).toContain("End must be after start")

    // Fix end time, switch recurrence to count, save successfully
    await dateInputs[1]!.setValue("2026-05-20T14:00")
    const selects = w.findAll("select")
    await selects[2]!.setValue("count")
    await nextTick()
    const numInput = w.find('input[type="number"]')
    await numInput.setValue("5")

    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({
      id: "e1", calendar_id: "c1", title: "Dentist Updated", description: "Bring card",
      start_at: "2026-05-20T12:00:00Z", end_at: "2026-05-20T14:00:00Z",
      all_day: false, recurrence: { freq: "weekly", count: 5 },
      reminder_minutes: 30, assignee_id: "m1",
      source: "internal", external_uid: null, created_by: null,
      created_at: "", updated_at: "",
    }), { status: 200 }))

    const saveBtn = w.findAll("button").find(b => b.text().includes("Save"))!
    await saveBtn.trigger("click")
    await flushPromises()
    expect(w.find(".edp-form").exists()).toBe(false)

    // Re-enter edit with count recurrence & all-day multi-day save + failed save branch
    ev.upsertEvent({
      id: "e1", calendarId: "c1", title: "Trip", description: "",
      startAt: "2026-05-15T00:00:00Z", endAt: "2026-05-17T00:00:00Z",
      allDay: true, recurrence: { freq: "custom_freq", count: 3 },
      reminderMinutes: null, assigneeId: undefined,
      source: "internal", externalUid: null, createdBy: null,
      createdAt: "", updatedAt: "",
    })
    await nextTick()
    expect(w.text()).toContain("All day")
    expect(w.text()).toContain("custom_freq")
    expect(w.text()).toContain("Unassigned")

    await w.findAll("button").find(b => b.text().includes("Edit"))!.trigger("click")
    // Save fails → sets editError
    vi.mocked(fetch).mockRejectedValueOnce(new Error("500"))
    await w.findAll("button").find(b => b.text().includes("Save"))!.trigger("click")
    await flushPromises()
    expect(w.find(".edp-form").exists()).toBe(true)

    // Cancel edit
    await w.findAll("button").find(b => b.text().includes("Cancel"))!.trigger("click")

    // Delete confirm + cancel + confirmDelete
    await w.findAll("button").find(b => b.text().includes("Delete"))!.trigger("click")
    expect(w.text()).toContain("Delete this event?")
    await w.findAll("button").find(b => b.text() === "Cancel")!.trigger("click")
    await w.findAll("button").find(b => b.text().includes("Delete"))!.trigger("click")
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 204 }))
    await w.findAll("button").find(b => b.text() === "Delete")!.trigger("click")
    await flushPromises()
    expect(ev.events.value).toHaveLength(0)
  })
})

describe("TaskDetailPanel", () => {
  beforeEach(() => {
    setLowPower(true)
  })

  it("renders empty state when task missing", () => {
    const w = mount(TaskDetailPanel)
    expect(w.text()).toContain("Task not found")
  })

  it("renders task details, edits (success & failure), and deletes", async () => {
    const tk = useTasks()
    const mb = useMembers()
    const ui = useUi()

    mb.upsertMember({
      id: "m1", householdId: "h", name: "Bob", avatarUrl: null,
      color: "#fcd0a1", role: "member", joinedAt: "",
    })
    tk.upsertTask({
      id: "t1", listId: "l1", title: "Mow lawn", description: "Front & back",
      assigneeId: "m1", startAt: "2026-05-15T00:00:00Z", endAt: null,
      status: "doing", priority: "high", position: 0,
      createdBy: null, createdAt: "", updatedAt: "",
    })

    ui.openDrawer("task-detail", "t1")
    await nextTick()

    const w = mount(TaskDetailPanel)
    expect(w.text()).toContain("Mow lawn")
    expect(w.text()).toContain("In Progress")
    expect(w.text()).toContain("High")
    expect(w.text()).toContain("Bob")
    expect(w.text()).toContain("Front & back")

    // Edit flow
    await w.findAll("button").find(b => b.text().includes("Edit"))!.trigger("click")
    expect(w.find(".tdp-form").exists()).toBe(true)

    const dateInput = w.find('input[type="date"]')
    await dateInput.setValue("2026-05-20")

    // Failed save keeps form open
    vi.mocked(fetch).mockRejectedValueOnce(new Error("fail"))
    await w.findAll("button").find(b => b.text().includes("Save"))!.trigger("click")
    await flushPromises()
    expect(w.find(".tdp-form").exists()).toBe(true)

    // Successful save closes form
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({
      id: "t1", list_id: "l1", title: "Mow lawn", description: "Front & back",
      assignee_id: "m1", start_at: "2026-05-20T00:00:00Z", end_at: null,
      status: "done", priority: "high", position: 0,
      created_by: null, created_at: "", updated_at: "",
    }), { status: 200 }))
    await w.findAll("button").find(b => b.text().includes("Save"))!.trigger("click")
    await flushPromises()
    expect(w.find(".tdp-form").exists()).toBe(false)

    // Delete flow
    await w.findAll("button").find(b => b.text().includes("Delete"))!.trigger("click")
    await w.findAll("button").find(b => b.text() === "Cancel")!.trigger("click")
    await w.findAll("button").find(b => b.text().includes("Delete"))!.trigger("click")
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 204 }))
    await w.findAll("button").find(b => b.text() === "Delete")!.trigger("click")
    await flushPromises()
    expect(tk.tasks.value).toHaveLength(0)
  })
})

describe("OnboardingWizard & MobileOnboardingGate", () => {
  beforeEach(() => {
    setLowPower(true)
    localStorage.setItem(HOUSEHOLD_COMPLETE_KEY, "true")
    invalidateSettings()
  })

  it("MobileOnboardingGate renders message", () => {
    const g = mount(MobileOnboardingGate)
    expect(g.text()).toContain("HOMST")
    expect(g.text()).toContain("Open HOMST on your laptop or PC")
  })

  it("OnboardingWizard walks through all 4 steps, manages members/colors, and finishes", async () => {
    const w = mount(OnboardingWizard, { global: { plugins: [router] } })

    // Step 1: house name + address
    const inputs1 = w.findAll("input")
    await inputs1[0]!.setValue("Maple House")
    await inputs1[1]!.setValue("100 Queen St")
    await w.findAll("button").find(b => b.text().includes("Next"))!.trigger("click")

    // Step 2: members — add second member, change color, remove second member, fill name
    expect(w.text()).toContain("Household Members")
    await w.find(".add-member-btn").trigger("click")
    expect(w.findAll(".member-row")).toHaveLength(2)

    const colorOpts = w.findAll(".color-opt")
    await colorOpts[2]!.trigger("click")

    await w.find(".member-remove").trigger("click")
    expect(w.findAll(".member-row")).toHaveLength(1)

    await w.find("input.member-input").setValue("Alice")
    await w.findAll("button").find(b => b.text().includes("Back"))!.trigger("click")
    expect(w.text()).toContain("Welcome to HOMST")
    await w.findAll("button").find(b => b.text().includes("Next"))!.trigger("click")
    await w.findAll("button").find(b => b.text().includes("Next"))!.trigger("click")

    // Step 3: holidays
    expect(w.text()).toContain("Holiday Calendar")
    await w.find("select").setValue("US")
    await w.find("input").setValue("California")
    await w.findAll("button").find(b => b.text().includes("Next"))!.trigger("click")

    // Step 4: review & finish
    expect(w.text()).toContain("All set!")
    expect(w.text()).toContain("Maple House")
    expect(w.text()).toContain("100 Queen St")
    expect(w.text()).toContain("California")

    vi.mocked(fetch).mockImplementation(async (url, opts) => {
      const u = String(url)
      if (u.includes("/calendars") && opts?.method === "POST") {
        return new Response(JSON.stringify({
          id: "c1", household_id: "h", name: "Personal", color: "sage",
          source: "internal", feed_url: null, is_visible: true, created_by: null,
        }), { status: 201 })
      }
      if (u.includes("/members") && opts?.method === "POST") {
        return new Response(JSON.stringify({
          id: "m1", household_id: "h", name: "Alice", avatar_url: null,
          color: "sage", role: "member", joined_at: "",
        }), { status: 201 })
      }
      return new Response(JSON.stringify({ isComplete: true }), { status: 200 })
    })

    await w.findAll("button").find(b => b.text().includes("Confirm"))!.trigger("click")
    await flushPromises()
    expect(useEvents().calendars.value[0]?.name).toBe("Maple House")
    expect(useMembers().members.value).toHaveLength(1)
  })
})
