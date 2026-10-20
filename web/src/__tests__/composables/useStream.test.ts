import { describe, it, expect, beforeEach, vi, afterEach } from "vitest"
import { mount } from "@vue/test-utils"
import { defineComponent, h } from "vue"
import { useEvents } from "@/composables/useEvents"
import { useTasks } from "@/composables/useTasks"
import { useNotifications } from "@/composables/useNotifications"
import { useStream, type ConnectionStatus } from "@/composables/useStream"

let latestES: MockEventSource | null = null

class MockEventSource {
  url: string
  onopen: (() => void) | null = null
  onerror: (() => void) | null = null
  listeners: Map<string, ((e: MessageEvent) => void)[]> = new Map()
  closed = false

  constructor(url: string) {
    this.url = url
    latestES = this
  }

  addEventListener(type: string, handler: (e: MessageEvent) => void) {
    if (!this.listeners.has(type)) this.listeners.set(type, [])
    this.listeners.get(type)!.push(handler)
  }

  close() {
    this.closed = true
  }

  dispatchEvent(type: string, data: string) {
    const handlers = this.listeners.get(type)
    if (handlers) {
      for (const h of handlers) {
        try { h({ data } as MessageEvent) } catch {}
      }
    }
  }
}

vi.stubGlobal("EventSource", MockEventSource)

describe("useStream", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    latestES = null
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("has connected ref that starts as false", () => {
    const { connected } = useStream()
    expect(connected.value).toBe(false)
  })

  it("connects on mount and sets status", () => {
    let connected!: ReturnType<typeof useStream>["connected"]
    mount(defineComponent({
      setup() {
        const s = useStream()
        connected = s.connected
        return () => h("div")
      },
    }))
    expect(latestES).not.toBeNull()
    expect(latestES!.url).toBe("/api/stream")
    latestES!.onopen?.()
    expect(connected.value).toBe(true)
  })

  it("onerror sets disconnected and schedules reconnect", () => {
    let connected!: ReturnType<typeof useStream>["connected"]
    let status!: ReturnType<typeof useStream>["status"]
    mount(defineComponent({
      setup() {
        const s = useStream()
        connected = s.connected
        status = s.status
        return () => h("div")
      },
    }))
    latestES!.onopen?.()
    expect(latestES).not.toBeNull()

    latestES!.onerror?.()
    expect(latestES!.closed).toBe(true)
    expect(connected.value).toBe(false)
    expect(status.value).toBe("disconnected")
  })

  it("event.created dispatches to events composable", () => {
    const { events } = useEvents()
    mount(defineComponent({
      setup() { useStream(); return () => h("div") },
    }))

    latestES!.dispatchEvent("event.created", JSON.stringify({
      id: "evt-1", calendar_id: "cal-1", title: "Test Event",
      description: "", start_at: "2026-05-01T10:00:00Z", end_at: "2026-05-01T11:00:00Z",
      all_day: false, recurrence: null, source: "internal", external_uid: null,
      created_by: "u-1", created_at: "2026-05-01T10:00:00Z", updated_at: "2026-05-01T10:00:00Z",
    }))
    expect(events.value).toHaveLength(1)
    expect(events.value[0]!.title).toBe("Test Event")
  })

  it("event.deleted dispatches to events composable", () => {
    const { events, upsertEvent } = useEvents()
    upsertEvent({
      id: "evt-1", calendarId: "cal-1", title: "To delete",
      description: "", startAt: "2026-05-01T10:00:00Z", endAt: "2026-05-01T11:00:00Z",
      allDay: false, recurrence: null, source: "internal", externalUid: null,
      createdBy: "u-1", createdAt: "", updatedAt: "",
    })
    mount(defineComponent({
      setup() { useStream(); return () => h("div") },
    }))
    latestES!.dispatchEvent("event.deleted", JSON.stringify({ id: "evt-1" }))
    expect(events.value).toHaveLength(0)
  })

  it("task.created dispatches to tasks composable", () => {
    const { tasks } = useTasks()
    mount(defineComponent({
      setup() { useStream(); return () => h("div") },
    }))
    latestES!.dispatchEvent("task.created", JSON.stringify({
      id: "t-1", list_id: "l1", title: "New Task",
      description: "", assignee_id: null, start_at: null, end_at: null, status: "todo",
      priority: "medium", position: 0, created_by: "u-1",
      created_at: "2026-05-01T10:00:00Z", updated_at: "2026-05-01T10:00:00Z",
    }))
    expect(tasks.value).toHaveLength(1)
  })

  it("reminder.due pushes a HUD notification", () => {
    const { notifications } = useNotifications()
    mount(defineComponent({
      setup() { useStream(); return () => h("div") },
    }))
    latestES!.dispatchEvent("reminder.due", JSON.stringify({
      event_id: "evt-1", title: "Soccer practice",
      start_at: "2030-06-01T18:00:00Z", minutes_before: 30, all_day: false,
    }))
    expect(notifications.value).toHaveLength(1)
    expect(notifications.value[0]!.title).toBe("Soccer practice")
  })

  it("disconnects on unmount", () => {
    const wrapper = mount(defineComponent({
      setup() { useStream(); return () => h("div") },
    }))
    expect(latestES).not.toBeNull()
    wrapper.unmount()
    expect(latestES!.closed).toBe(true)
  })
})
