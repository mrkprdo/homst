import { describe, expect, it, vi } from "vitest"
import { bootstrapApi } from "@/api/bootstrap"
import { useAnnouncements } from "@/composables/useAnnouncements"
import { useEvents } from "@/composables/useEvents"
import { useMembers } from "@/composables/useMembers"
import { useSettings } from "@/composables/useSettings"
import { useTasks } from "@/composables/useTasks"
import { threeMonthRange } from "@/lib/householdRange"
import { ensureHouseholdLoaded, loadHousehold } from "@/lib/hydrate"

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } })

const payload = {
  settings: {
    isComplete: true,
    houseName: "Casa",
    address: "1 Main St",
    holidayCountry: "CA",
    holidayProvince: "ON",
    lat: 45.4,
    lon: -75.7,
    theme: "dark",
    themePreset: "default",
    accentColor: "sage",
    fontSize: "large",
    warm: true,
    widgetLayout: [{ id: "clock", col: 0, row: 0, w: 1, h: 1 }],
  },
  members: [
    {
      id: "m1",
      household_id: "h",
      name: "Ada",
      avatar_url: null,
      color: null,
      role: "admin",
      joined_at: "2026-01-01T00:00:00Z",
    },
  ],
  photos: [{ id: "p1", url: "/uploads/photos/a.jpg", selected: true, created_at: "2026-01-01T00:00:00Z" }],
  calendars: [
    {
      id: "c1",
      household_id: "h",
      name: "Personal",
      color: "sage",
      source: "internal",
      feed_url: null,
      is_visible: true,
      created_by: null,
    },
  ],
  events: [
    {
      id: "e1",
      calendar_id: "c1",
      title: "Dentist",
      description: "",
      start_at: "2026-05-10T10:00:00Z",
      end_at: null,
      all_day: false,
      recurrence: null,
      source: "internal",
      external_uid: null,
      created_by: null,
      created_at: "2026-05-01T00:00:00Z",
      updated_at: "2026-05-01T00:00:00Z",
    },
  ],
  task_lists: [{ id: "l1", household_id: "h", name: "Chores", color: "sage", position: 0 }],
  tasks: [
    {
      id: "t1",
      list_id: "l1",
      title: "Vacuum",
      description: "",
      assignee_id: null,
      start_at: null,
      end_at: null,
      status: "todo",
      priority: "medium",
      position: 0,
      created_by: null,
      created_at: "2026-05-01T00:00:00Z",
      updated_at: "2026-05-01T00:00:00Z",
    },
  ],
  holidays: [
    {
      id: "h1",
      household_id: "h",
      date: "2026-05-01",
      name: "May Day",
      local_name: null,
      country_code: "US",
      province: null,
      created_at: "2026-05-01T00:00:00Z",
    },
  ],
  announcements: [
    {
      id: "a1",
      household_id: "h",
      message: "Dinner at seven",
      created_by: null,
      author_name: null,
      created_at: "2026-05-01T00:00:00Z",
      expires_at: null,
    },
  ],
}

describe("threeMonthRange", () => {
  it("spans the previous, current and next month across a year boundary", () => {
    const range = threeMonthRange(new Date(2026, 0, 15))
    expect(range.from).toBe(new Date(2025, 11, 1).toISOString())
    expect(range.to).toBe(new Date(2026, 2, 0, 23, 59, 59).toISOString())
    expect(range.months).toEqual(["2025-11", "2026-0", "2026-1"])

    const december = threeMonthRange(new Date(2026, 11, 15))
    expect(december.months).toEqual(["2026-10", "2026-11", "2027-0"])
    expect(december.to).toBe(new Date(2027, 1, 0, 23, 59, 59).toISOString())
  })
})

describe("bootstrapApi", () => {
  it("maps every collection and defaults missing ones to empty arrays", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json(payload))
    const loaded = await bootstrapApi.load("2026-04-01", "2026-06-30")
    expect(loaded.members[0]!.name).toBe("Ada")
    expect(loaded.calendars[0]!.id).toBe("c1")
    expect(loaded.events[0]!.title).toBe("Dentist")
    expect(loaded.taskLists[0]!.name).toBe("Chores")
    expect(loaded.tasks[0]!.title).toBe("Vacuum")
    expect(loaded.holidays[0]!.name).toBe("May Day")
    expect(loaded.announcements[0]!.message).toBe("Dinner at seven")

    vi.mocked(fetch).mockResolvedValueOnce(json({ settings: {} }))
    const minimal = await bootstrapApi.load("2026-04-01", "2026-06-30")
    expect(minimal.members).toEqual([])
    expect(minimal.photos).toEqual([])
    expect(minimal.events).toEqual([])
  })

  it("rejects payloads that are not an object with settings", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json([]))
    await expect(bootstrapApi.load("a", "b")).rejects.toThrow("Invalid bootstrap payload")

    vi.mocked(fetch).mockResolvedValueOnce(json({}))
    await expect(bootstrapApi.load("a", "b")).rejects.toThrow("Invalid bootstrap payload")
  })
})

describe("loadHousehold", () => {
  it("hydrates settings and every store from one request", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json(payload))
    const loaded = await loadHousehold()
    expect(loaded.settings.isComplete).toBe(true)

    const url = String(vi.mocked(fetch).mock.calls[0]![0])
    expect(url).toContain("/bootstrap?from=")

    const settings = useSettings()
    expect(settings.theme.value).toBe("dark")
    expect(settings.houseName.value).toBe("Casa")
    expect(settings.address.value).toBe("1 Main St")
    expect(settings.holidayCountry.value).toBe("CA")
    expect(settings.holidayProvince.value).toBe("ON")
    expect(settings.lat.value).toBe(45.4)
    expect(settings.lon.value).toBe(-75.7)
    expect(settings.widgetLayout.value).toHaveLength(1)
    expect(settings.photos.value).toHaveLength(1)

    expect(useMembers().members.value[0]!.name).toBe("Ada")
    expect(useTasks().lists.value[0]!.name).toBe("Chores")
    expect(useTasks().tasks.value[0]!.title).toBe("Vacuum")
    expect(useAnnouncements().announcements.value[0]!.message).toBe("Dinner at seven")

    const calendarIds = useEvents().calendars.value.map((c) => c.id)
    expect(calendarIds).toContain("c1")
    expect(calendarIds).toContain("00000000-0000-0000-0000-000000000001")
    const titles = useEvents().events.value.map((e) => e.title)
    expect(titles).toContain("Dentist")
    expect(titles).toContain("May Day")
  })

  it("shares one in-flight request and resets after it settles", async () => {
    let resolveFetch!: (response: Response) => void
    vi.mocked(fetch).mockReturnValueOnce(
      new Promise<Response>((resolve) => { resolveFetch = resolve }),
    )

    const first = loadHousehold()
    const second = loadHousehold()
    expect(first).toBe(second)
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1)

    resolveFetch(json(payload))
    await Promise.all([first, second])
    expect(useMembers().members.value[0]!.name).toBe("Ada")

    vi.mocked(fetch).mockResolvedValueOnce(json(payload))
    await loadHousehold()
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2)
  })
})

describe("announcement refresh", () => {
  it("reloads the announcement store", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json(payload.announcements))
    const store = useAnnouncements()
    await store.refresh()
    expect(store.announcements.value[0]!.message).toBe("Dinner at seven")
  })
})

describe("ensureHouseholdLoaded", () => {
  it("fetches once and then reuses the hydrated stores", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json(payload))
    const first = await ensureHouseholdLoaded()
    expect(first?.settings.isComplete).toBe(true)

    vi.mocked(fetch).mockClear()
    expect(await ensureHouseholdLoaded()).toBeNull()
    expect(vi.mocked(fetch)).not.toHaveBeenCalled()
  })
})
