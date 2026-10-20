import { describe, it, expect, vi, beforeEach } from "vitest"
import { nextTick } from "vue"
import { mount, flushPromises } from "@vue/test-utils"
import { setLowPower } from "@/lib/motion"
import { useEvents, type Event } from "@/composables/useEvents"
import { useTasks, type Task } from "@/composables/useTasks"
import { useMembers, type Member } from "@/composables/useMembers"
import { useUi } from "@/composables/useUi"
import EventDetailPanel from "@/components/events/EventDetailPanel.vue"
import TaskDetailPanel from "@/components/tasks/TaskDetailPanel.vue"

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })

const event = (o: Record<string, unknown> = {}): Event => ({
  id: "e1", calendarId: "c1", title: "Event", description: "",
  startAt: "2026-05-15T10:00:00Z", endAt: "2026-05-15T11:00:00Z",
  allDay: false, recurrence: null, reminderMinutes: null, assigneeId: undefined,
  source: "internal", externalUid: null, createdBy: null, createdAt: "", updatedAt: "",
  ...o,
})

const eventResponse = (o: Record<string, unknown> = {}) => ({
  id: "e1", calendar_id: "c1", title: "Event", description: "",
  start_at: "2026-05-20T00:00:00Z", end_at: null,
  all_day: true, recurrence: null, reminder_minutes: null, assignee_id: null,
  source: "internal", external_uid: null, created_by: null, created_at: "", updated_at: "",
  ...o,
})

const task = (o: Record<string, unknown> = {}): Task => ({
  id: "t1", listId: "l1", title: "Task", description: "", assigneeId: null,
  startAt: null, endAt: null, status: "todo", priority: "medium", position: 0,
  createdBy: null, createdAt: "", updatedAt: "",
  ...o,
})

const taskResponse = (o: Record<string, unknown> = {}) => ({
  id: "t1", list_id: "l1", title: "Task", description: "",
  assignee_id: null, start_at: null, end_at: null,
  status: "todo", priority: "medium", position: 0,
  created_by: null, created_at: "", updated_at: "",
  ...o,
})

/** Every write returns `body`; every read returns an empty list. */
function mockWrites(body: unknown) {
  vi.mocked(fetch).mockImplementation((async (_input: any, init?: any) => {
    const method = (init?.method ?? "GET").toUpperCase()
    return method === "GET" ? json([]) : json(body)
  }) as any)
}

const btn = (w: any, text: string) => w.findAll("button").find((b: any) => b.text().includes(text))!
const inputs = (w: any) => w.findAllComponents({ name: "UiInput" })
const selects = (w: any) => w.findAllComponents({ name: "UiSelect" })
const areas = (w: any) => w.findAllComponents({ name: "UiTextarea" })

function member(id: string, name: string): Member {
  return { id, householdId: "h", name, avatarUrl: null, color: "#b1b695", role: "member", joinedAt: "" }
}

beforeEach(() => {
  setLowPower(true)
})

describe("EventDetailPanel — edit-mode fields & validation", () => {
  it("covers recurrence fallbacks, v-model handlers, validation paths and .ics download", async () => {
    const ev = useEvents()
    const mb = useMembers()
    const ui = useUi()

    const createUrl = (URL as any).createObjectURL
    const revokeUrl = (URL as any).revokeObjectURL
    ;(URL as any).createObjectURL = vi.fn(() => "blob:mock")
    ;(URL as any).revokeObjectURL = vi.fn()
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {})

    try {
      mb.upsertMember(member("m1", "Alice"))
      mb.upsertMember(member("m2", "")) // unnamed → "Unnamed" fallback
      // all-day, no end, recurrence without until/count, assignee not in members
      ev.upsertEvent(event({ allDay: true, endAt: null, recurrence: { freq: "daily" }, assigneeId: "ghost" }))
      ui.openDrawer("event-detail", "e1")
      await nextTick()

      const w = mount(EventDetailPanel)
      await nextTick()
      expect(w.text()).toContain("Daily")
      expect(w.text()).toContain("Unassigned")

      // .ics export button
      await btn(w, ".ics").trigger("click")
      expect(anchorClick).toHaveBeenCalled()

      // Enter edit mode → startEdit's "forever" fallback (no until / no count)
      await btn(w, "Edit").trigger("click")
      await nextTick()
      expect(w.find(".edp-form").exists()).toBe(true)

      // v-model handlers: title, assignee, repeat, end-repeat, reminder, notes
      await inputs(w)[0]!.vm.$emit("update:modelValue", "")
      await selects(w)[0]!.vm.$emit("update:modelValue", "m2")
      await selects(w)[1]!.vm.$emit("update:modelValue", "weekly")
      await nextTick()
      await selects(w)[2]!.vm.$emit("update:modelValue", "date")
      await nextTick()
      await selects(w)[3]!.vm.$emit("update:modelValue", "")
      await areas(w)[0]!.vm.$emit("update:modelValue", "Notes")

      // Clear the start → unparsable dates + `min` falls back to undefined
      await inputs(w)[1]!.vm.$emit("update:modelValue", "")
      await nextTick()
      expect(inputs(w)[3]!.props("min")).toBeUndefined()

      // Save is blocked while the range is invalid
      await btn(w, "Save").trigger("click")
      await nextTick()
      expect(w.find(".edp-form").exists()).toBe(true)

      // All-day range with end before start → all-day error copy
      await inputs(w)[1]!.vm.$emit("update:modelValue", "2026-05-20")
      await inputs(w)[2]!.vm.$emit("update:modelValue", "2026-05-18")
      await nextTick()
      expect(w.text()).toContain("End date must be after the start date")

      // Times input ignores junk (`Number(v) || 0`)
      await selects(w)[2]!.vm.$emit("update:modelValue", "count")
      await nextTick()
      await inputs(w)[3]!.vm.$emit("update:modelValue", "nonsense")

      // Until input (date mode) feeds the recurrence end
      await selects(w)[2]!.vm.$emit("update:modelValue", "date")
      await nextTick()
      await inputs(w)[3]!.vm.$emit("update:modelValue", "2026-06-01")

      mockWrites(eventResponse({ recurrence: { freq: "weekly", until: "2026-06-01T23:59:59.000Z" } }))
      await inputs(w)[1]!.vm.$emit("update:modelValue", "2026-05-20")
      await inputs(w)[2]!.vm.$emit("update:modelValue", "2026-05-21")
      await nextTick()
      await btn(w, "Save").trigger("click")
      await flushPromises()
      expect(w.find(".edp-form").exists()).toBe(false)

      const patch = vi.mocked(fetch).mock.calls.find(c => (c[1] as any)?.method === "PATCH")!
      const saved = JSON.parse((patch[1] as any).body)
      expect(saved.recurrence.freq).toBe("weekly")
      expect(typeof saved.recurrence.until).toBe("string")
      expect(saved.all_day).toBe(true)
      expect(saved.title).toBe("Event") // empty title falls back to the stored one

      // Re-enter: "forever" end-repeat builds an empty recurrence end
      await btn(w, "Edit").trigger("click")
      await nextTick()
      await inputs(w)[1]!.vm.$emit("update:modelValue", "2026-05-20")
      await inputs(w)[2]!.vm.$emit("update:modelValue", "2026-05-21")
      await selects(w)[1]!.vm.$emit("update:modelValue", "monthly")
      await nextTick()
      await selects(w)[2]!.vm.$emit("update:modelValue", "forever")
      await nextTick()
      mockWrites(eventResponse({ recurrence: { freq: "monthly" } }))
      await btn(w, "Save").trigger("click")
      await flushPromises()
      const lastPatch = vi.mocked(fetch).mock.calls.filter(c => (c[1] as any)?.method === "PATCH").at(-1)!
      expect(JSON.parse((lastPatch[1] as any).body).recurrence).toEqual({ freq: "monthly" })

      // "Does not repeat" stores null
      await btn(w, "Edit").trigger("click")
      await nextTick()
      await inputs(w)[1]!.vm.$emit("update:modelValue", "2026-05-20")
      await inputs(w)[2]!.vm.$emit("update:modelValue", "2026-05-21")
      await selects(w)[1]!.vm.$emit("update:modelValue", "none")
      await nextTick()
      mockWrites(eventResponse())
      await btn(w, "Save").trigger("click")
      await flushPromises()
      const nonePatch = vi.mocked(fetch).mock.calls.filter(c => (c[1] as any)?.method === "PATCH").at(-1)!
      expect(JSON.parse((nonePatch[1] as any).body).recurrence).toBeNull()

      w.unmount()
    } finally {
      ;(URL as any).createObjectURL = createUrl
      ;(URL as any).revokeObjectURL = revokeUrl
      anchorClick.mockRestore()
    }
  })
})

describe("TaskDetailPanel — edit-mode fields & fallbacks", () => {
  it("renders a task without dates or assignee", async () => {
    const tk = useTasks()
    const ui = useUi()
    tk.upsertTask(task({ id: "t1", title: "Bare", startAt: null }))
    ui.openDrawer("task-detail", "t1")
    await nextTick()

    const w = mount(TaskDetailPanel)
    expect(w.text()).toContain("Bare")
    expect(w.find(".tdp-fields").text()).toBe("")
    w.unmount()
  })

  it("ignores an assignee id that matches no member", async () => {
    const tk = useTasks()
    const ui = useUi()
    tk.upsertTask(task({ assigneeId: "ghost" }))
    ui.openDrawer("task-detail", "t1")
    await nextTick()

    const w = mount(TaskDetailPanel)
    expect(w.find(".tdp-fields").text()).toBe("")
    w.unmount()
  })

  it("edits, cancels and saves with empty optional fields", async () => {
    const tk = useTasks()
    const mb = useMembers()
    const ui = useUi()

    mb.upsertMember(member("m1", "Alice"))
    mb.upsertMember(member("m2", "")) // unnamed
    tk.upsertTask(task({ startAt: "2026-05-15T00:00:00Z", assigneeId: "m1", description: "notes" }))
    ui.openDrawer("task-detail", "t1")
    await nextTick()

    const w = mount(TaskDetailPanel)
    expect(w.text()).toContain("Alice")

    // Edit → v-model handlers, then cancel
    await btn(w, "Edit").trigger("click")
    await nextTick()
    expect(w.find(".tdp-form").exists()).toBe(true)
    expect(selects(w)[2]!.text()).toContain("Unnamed")

    await inputs(w)[0]!.vm.$emit("update:modelValue", "Renamed")
    await selects(w)[0]!.vm.$emit("update:modelValue", "done")
    await selects(w)[1]!.vm.$emit("update:modelValue", "low")
    await selects(w)[2]!.vm.$emit("update:modelValue", "m2")
    await areas(w)[0]!.vm.$emit("update:modelValue", "new notes")
    await nextTick()
    await btn(w, "Cancel").trigger("click")
    await nextTick()
    expect(w.find(".tdp-form").exists()).toBe(false)
    expect(w.text()).toContain("Task") // unchanged

    // Edit → blank optional fields → nulls in the payload
    await btn(w, "Edit").trigger("click")
    await nextTick()
    await inputs(w)[0]!.vm.$emit("update:modelValue", "")
    await w.find('input[type="date"]').setValue("")
    await selects(w)[2]!.vm.$emit("update:modelValue", "")
    await nextTick()

    mockWrites(taskResponse({ title: "Task" }))
    await btn(w, "Save").trigger("click")
    await flushPromises()
    expect(w.find(".tdp-form").exists()).toBe(false)

    const patch = vi.mocked(fetch).mock.calls.find(c => (c[1] as any)?.method === "PATCH")!
    const body = JSON.parse((patch[1] as any).body)
    expect(body.start_at).toBeNull()
    expect(body.assignee_id).toBeNull()

    w.unmount()
  })
})
