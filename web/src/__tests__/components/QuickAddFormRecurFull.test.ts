import { describe, it, expect, beforeEach, vi } from "vitest"
import { mount } from "@vue/test-utils"
import QuickAddForm from "@/components/shared/QuickAddForm.vue"
import { useUi } from "@/composables/useUi"
import { useEvents } from "@/composables/useEvents"
import { useMembers } from "@/composables/useMembers"

const field = (w: ReturnType<typeof mount>, label: string) =>
  w.findAll(".ui-field").find(f => f.text().includes(label))

const settle = () => new Promise(r => setTimeout(r, 0))

const apiEvent = () => ({
  id: "ev-new", calendar_id: "cal-default", title: "Created", description: "",
  start_at: "2026-08-01T10:00:00.000Z", end_at: "2026-08-01T11:00:00.000Z",
  all_day: false, recurrence: null, source: "internal", external_uid: null,
  created_by: null, created_at: "", updated_at: "",
})

const POST = () => vi.mocked(fetch).mock.calls.find(c => (c[1] as any)?.method === "POST")!
const body = () => JSON.parse((POST()[1] as any).body)

beforeEach(() => {
  useUi().activePanel.value = "calendar"
  useEvents().upsertCalendar({
    id: "cal-default", householdId: "h-1", name: "Family", color: "forest",
    source: "internal", feedUrl: null, isVisible: true, createdBy: "u-1",
  })
  useMembers().upsertMember({
    id: "m1", householdId: "h-1", name: "Alice", avatarUrl: null, color: "#00ff00",
    role: "member", joinedAt: "",
  })
  vi.mocked(fetch).mockImplementation(async () =>
    new Response(JSON.stringify(apiEvent()), { status: 200, headers: { "content-type": "application/json" } }),
  )
})

async function submit(w: ReturnType<typeof mount>) {
  await w.findAllComponents({ name: "UiButton" })[1]!.trigger("click")
  await settle()
}

describe("QuickAddForm — recurrence payloads and time guards", () => {
  it("stores an until date for a recurring event", async () => {
    const w = mount(QuickAddForm)
    await w.find("input[placeholder='Event title']").setValue("Weekly standup")
    await field(w, "Assigned to")!.find("select").setValue("m1")
    await w.findComponent({ name: "UiTextarea" }).vm.$emit("update:modelValue", "bring coffee")

    await field(w, "Repeat")!.find("select").setValue("weekly")
    await field(w, "End repeat")!.find("select").setValue("date")
    await field(w, "Until")!.find("input").setValue("2026-09-30")

    await submit(w)
    expect(body().recurrence.freq).toBe("weekly")
    expect(typeof body().recurrence.until).toBe("string")
    expect(body().assignee_id).toBe("m1")
    expect(body().description).toBe("bring coffee")
  })

  it("stores an occurrence count for a recurring event", async () => {
    const w = mount(QuickAddForm)
    await w.find("input[placeholder='Event title']").setValue("Daily reset")
    await field(w, "Repeat")!.find("select").setValue("daily")
    await field(w, "End repeat")!.find("select").setValue("count")

    // non-numeric input collapses to 0
    const times = () => field(w, "Times")!.find("input")
    await times().setValue("")
    await submit(w)
    expect(body().recurrence).toEqual({ freq: "daily", count: 0 })
  })

  it("omits the recurrence end when it repeats forever", async () => {
    const w = mount(QuickAddForm)
    await w.find("input[placeholder='Event title']").setValue("Forever")
    await field(w, "Repeat")!.find("select").setValue("monthly")
    await submit(w)
    expect(body().recurrence).toEqual({ freq: "monthly" })
  })

  it("survives an unparsable start time and an empty one", async () => {
    const w = mount(QuickAddForm)
    await w.find("input[placeholder='Event title']").setValue("Odd time")

    let times = w.findAll("input[type='time']")
    await times[0]!.setValue("99:99")
    expect(w.find(".summary-preview").text()).toBeTruthy()

    times = w.findAll("input[type='time']")
    await times[0]!.setValue("")
    expect(w.find(".summary-preview").text()).toBeTruthy()

    // a later valid start time re-derives the end time
    times = w.findAll("input[type='time']")
    await times[0]!.setValue("23:30")
    times = w.findAll("input[type='time']")
    expect((times[1]!.element as HTMLInputElement).value).toBe("00:30")
  })
})
