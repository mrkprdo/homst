import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { mount, flushPromises } from "@vue/test-utils"
import { defineComponent, h } from "vue"
import { useEvents } from "@/composables/useEvents"
import { useTasks } from "@/composables/useTasks"
import { useMembers } from "@/composables/useMembers"
import { useAnnouncements } from "@/composables/useAnnouncements"
import { useSettings } from "@/composables/useSettings"
import { useUpdatePrompt } from "@/composables/useUpdatePrompt"
import { useStream, _resetStream } from "@/composables/useStream"

let latestES: MockEventSource | null = null

class MockEventSource {
  static instances: MockEventSource[] = []
  url: string
  onopen: (() => void) | null = null
  onerror: (() => void) | null = null
  listeners = new Map<string, ((e: MessageEvent) => void)[]>()
  closed = false

  constructor(url: string) {
    this.url = url
    latestES = this
    MockEventSource.instances.push(this)
  }

  addEventListener(type: string, handler: (e: MessageEvent) => void) {
    if (!this.listeners.has(type)) this.listeners.set(type, [])
    this.listeners.get(type)!.push(handler)
  }

  close() {
    this.closed = true
  }

  dispatch(type: string, data: unknown) {
    this.dispatchRaw(type, JSON.stringify(data))
  }

  dispatchRaw(type: string, data: string) {
    for (const handler of this.listeners.get(type) ?? []) {
      handler({ data } as MessageEvent)
    }
  }
}

vi.stubGlobal("EventSource", MockEventSource)

function mountStream() {
  return mount(defineComponent({ setup() { useStream(); return () => h("div") } }))
}

describe("useStream (full)", () => {
  beforeEach(() => {
    latestES = null
    MockEventSource.instances = []
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it("starts in the connecting state", () => {
    let status!: ReturnType<typeof useStream>["status"]
    mount(defineComponent({ setup() { status = useStream().status; return () => h("div") } }))
    expect(status.value).toBe("connecting")
    expect(latestES!.url).toBe("/api/stream")
  })

  it("applies task.updated and task.deleted events", () => {
    const { tasks } = useTasks()
    mountStream()

    latestES!.dispatch("task.updated", {
      id: "t1", list_id: "l1", title: "Renamed task", description: "",
      assignee_id: null, start_at: null, end_at: null, status: "doing",
      priority: "high", position: 0, created_by: null, created_at: "", updated_at: "",
    })
    expect(tasks.value).toHaveLength(1)
    expect(tasks.value[0]!.title).toBe("Renamed task")
    expect(tasks.value[0]!.status).toBe("doing")

    latestES!.dispatch("task.deleted", { id: "t1" })
    expect(tasks.value).toHaveLength(0)
  })

  it("applies member.joined, member.updated and member.removed events", () => {
    const { members } = useMembers()
    mountStream()

    // The API publishes snake_case member payloads — they must be mapped.
    latestES!.dispatch("member.joined", {
      id: "m1", household_id: "h1", name: "Zoe", avatar_url: null,
      color: "sage-base", role: "member", joined_at: "2026-05-01T00:00:00Z",
    })
    expect(members.value).toHaveLength(1)
    expect(members.value[0]!.name).toBe("Zoe")
    expect(members.value[0]!.householdId).toBe("h1")

    latestES!.dispatch("member.updated", {
      id: "m1", household_id: "h1", name: "Zoë", avatar_url: "https://x/a.png",
      color: "plum-base", role: "admin", joined_at: "2026-05-01T00:00:00Z",
    })
    expect(members.value).toHaveLength(1)
    expect(members.value[0]!.name).toBe("Zoë")
    expect(members.value[0]!.avatarUrl).toBe("https://x/a.png")
    expect(members.value[0]!.role).toBe("admin")

    latestES!.dispatch("member.removed", { id: "m1" })
    expect(members.value).toHaveLength(0)
  })

  it("applies event.updated events", () => {
    const { events } = useEvents()
    mountStream()

    latestES!.dispatch("event.updated", {
      id: "e1", calendar_id: "c1", title: "Renamed event", description: "",
      start_at: "2026-05-01T10:00:00Z", end_at: null, all_day: false,
      recurrence: null, source: "internal", external_uid: null,
      created_by: null, created_at: "", updated_at: "",
    })
    expect(events.value).toHaveLength(1)
    expect(events.value[0]!.title).toBe("Renamed event")
  })

  it("applies announcement.created and announcement.deleted events", () => {
    const { announcements } = useAnnouncements()
    mountStream()

    latestES!.dispatch("announcement.created", {
      id: "a1",
      household_id: "h1",
      message: "Dinner is ready",
      created_by: null,
      author_name: null,
      created_at: "2026-06-01T18:00:00Z",
      expires_at: null,
    })
    expect(announcements.value).toHaveLength(1)
    expect(announcements.value[0]!.message).toBe("Dinner is ready")

    latestES!.dispatch("announcement.deleted", { id: "a1" })
    expect(announcements.value).toHaveLength(0)
  })

  it("relays a widget layout in settings.updated to a window event", () => {
    mountStream()
    const seen: unknown[] = []
    const handler = (e: Event) => seen.push((e as CustomEvent).detail)
    window.addEventListener("homst:widget-layout-updated", handler)

    latestES!.dispatch("settings.updated", { settings: { widgetLayout: [{ id: "datetime" }] } })
    expect(seen).toHaveLength(1)
    expect(seen[0]).toEqual([{ id: "datetime" }])

    // No layout, or no settings at all — nothing is dispatched.
    latestES!.dispatch("settings.updated", { settings: { theme: "dark" } })
    latestES!.dispatch("settings.updated", {})
    expect(seen).toHaveLength(1)

    window.removeEventListener("homst:widget-layout-updated", handler)
  })

  it("applies the full settings payload from settings.updated to the shared store", () => {
    const settings = useSettings()
    mountStream()

    latestES!.dispatch("settings.updated", {
      settings: {
        theme: "dark",
        themePreset: "futur",
        accentColor: "honey",
        fontSize: "xlarge",
        warm: true,
        houseName: "Cedar",
        notifications: { hud: false, defaultReminderMinutes: 30 },
      },
    })

    expect(settings.theme.value).toBe("dark")
    expect(settings.themePreset.value).toBe("futur")
    expect(settings.accentColor.value).toBe("honey")
    expect(settings.fontSize.value).toBe("xlarge")
    expect(settings.warm.value).toBe(true)
    expect(settings.houseName.value).toBe("Cedar")
    expect(settings.hudEnabled.value).toBe(false)
    expect(settings.defaultReminderMinutes.value).toBe(30)
  })

  it("announces update changes so the settings card stays in sync", () => {
    mountStream()
    const changed = vi.fn()
    window.addEventListener("homst:update-changed", changed)

    latestES!.dispatch("system.update.starting", { version: "0.3.0", job_id: "job-1" })
    latestES!.dispatch("settings.updated", {
      settings: { updates: { enabled: false, checkIntervalMinutes: 15 } },
    })

    expect(changed).toHaveBeenCalledTimes(2)
    window.removeEventListener("homst:update-changed", changed)
  })

  it("re-fetches the shared photo list on photos.updated", async () => {
    vi.useRealTimers()
    const settings = useSettings()
    mountStream()
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify([
      { id: "p1", url: "/uploads/photos/p1.jpg", selected: true, created_at: "" },
    ]), { status: 200, headers: { "content-type": "application/json" } }))

    latestES!.dispatch("photos.updated", {})
    await flushPromises()

    expect(fetchMock.mock.calls.some(c => String(c[0]).includes("/photos"))).toBe(true)
    expect(settings.photos.value).toHaveLength(1)
  })

  it("offers update prompts from the stream and clears them on dismissal", () => {
    const { prompt } = useUpdatePrompt()
    mountStream()

    latestES!.dispatch("system.update.available", {
      version: "0.3.0",
      current: "0.2.0",
      major: false,
      html_url: "https://example.com/v0.3.0",
    })
    expect(prompt.value?.version).toBe("0.3.0")

    latestES!.dispatch("system.update.dismissed", { version: "0.3.0" })
    expect(prompt.value).toBeNull()
  })

  it("mirrors the installing state when another display starts the update", () => {
    const { prompt, installing } = useUpdatePrompt()
    mountStream()

    latestES!.dispatch("system.update.starting", {
      version: "0.3.0",
      job_id: "job-1",
    })

    expect(prompt.value?.version).toBe("0.3.0")
    expect(installing.value).toBe(true)
  })

  it("ignores malformed payloads without throwing", () => {
    mountStream()
    const types = ["event.created", "event.updated", "event.deleted", "task.created",
      "task.updated", "task.deleted", "member.joined", "member.updated", "member.removed",
      "settings.updated", "photos.updated", "reminder.due",
      "announcement.created", "announcement.deleted",
      "system.update.available", "system.update.dismissed", "system.update.starting"]
    for (const t of types) {
      expect(() => latestES!.dispatchRaw(t, "{ not json")).not.toThrow()
    }
  })

  it("reconnects with exponential backoff and refreshes stores after the gap", async () => {
    let status!: ReturnType<typeof useStream>["status"]
    mount(defineComponent({ setup() { status = useStream().status; return () => h("div") } }))
    const first = latestES!
    first.onopen?.()
    expect(status.value).toBe("connected")

    first.onerror?.()
    expect(status.value).toBe("disconnected")
    expect(first.closed).toBe(true)

    // First backoff window is 1000ms.
    await vi.advanceTimersByTimeAsync(999)
    expect(latestES).toBe(first)
    await vi.advanceTimersByTimeAsync(1)
    const second = latestES!
    expect(second).not.toBe(first)
    expect(status.value).toBe("connecting")

    const fetchMock = vi.mocked(fetch)
    fetchMock.mockClear()
    second.onopen?.()
    expect(status.value).toBe("connected")
    // The server asks for a resync on reconnect → full store refresh.
    second.dispatch("sync.required", { type: "sync.required" })
    expect(fetchMock).toHaveBeenCalled()

    const urls = fetchMock.mock.calls.map((c) => String(c[0]))
    // Household settings are refreshed too, so changes made while the kiosk
    // was offline (theme, reminder default, widget layout) are not missed.
    expect(urls.some((u) => u.includes("/household/settings"))).toBe(true)
  })

  it("does not refresh on the initial connection's sync.required", () => {
    mountStream()
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockClear()

    latestES!.onopen?.()
    latestES!.dispatch("sync.required", { type: "sync.required" })
    // The mount-time fetches already cover the first connect.
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("coalesces overlapping resync requests into one reload", async () => {
    mountStream()
    const first = latestES!
    first.onopen?.()
    first.onerror?.()
    await vi.advanceTimersByTimeAsync(1000)

    const second = latestES!
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockClear()
    second.onopen?.()
    second.dispatch("sync.required", { type: "sync.required" })
    const afterFirst = fetchMock.mock.calls.length
    second.dispatch("sync.required", { type: "sync.required" })
    // The in-flight reload absorbs the duplicate trigger.
    expect(fetchMock.mock.calls.length).toBe(afterFirst)
  })

  it("backs off further on repeated failures", async () => {
    mountStream()
    const first = latestES!
    first.onopen?.()
    first.onerror?.()
    await vi.advanceTimersByTimeAsync(1000)
    const second = latestES!
    expect(second).not.toBe(first)

    second.onerror?.()
    // Second attempt waits 2000ms, not 1000ms.
    await vi.advanceTimersByTimeAsync(1000)
    expect(latestES).toBe(second)
    await vi.advanceTimersByTimeAsync(1000)
    expect(latestES).not.toBe(second)
  })

  it("_resetStream closes the connection and clears state", () => {
    mountStream()
    const es = latestES!
    expect(es.closed).toBe(false)
    _resetStream()
    expect(es.closed).toBe(true)
  })

  it("disconnect() stops the stream", () => {
    let api!: ReturnType<typeof useStream>
    mount(defineComponent({ setup() { api = useStream(); return () => h("div") } }))
    const es = latestES!
    api.disconnect()
    expect(es.closed).toBe(true)
  })
})
