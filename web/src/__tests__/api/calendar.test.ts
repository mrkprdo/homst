import { describe, it, expect, beforeEach, vi } from "vitest"
import { calendarApi } from "@/api/calendar"
import { COLORS } from "@/__tests__/constants"

describe("calendarApi", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it("getCalendars fetches calendars", async () => {
    const cals = [{ id: "c1", name: "Family", color: "forest" }]
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(cals),
    } as Response)

    const result = await calendarApi.getCalendars()
    expect(result).toEqual(cals)
  })

  it("createCalendar posts data", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ id: "c1", name: "New" }),
    } as Response)

    await calendarApi.createCalendar({ name: "New", color: "forest" })
    expect(spy).toHaveBeenCalledWith("/api/v1/calendars", expect.objectContaining({
      method: "POST",
    }))
  })

  it("subscribeCalendar posts feed url", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ id: "c1" }),
    } as Response)

    await calendarApi.subscribeCalendar("https://cal.example.com/feed.ics")
    expect(spy).toHaveBeenCalledWith("/api/v1/calendars/subscribe", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ feed_url: "https://cal.example.com/feed.ics" }),
    }))
  })

  it("updateCalendar patches data", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ id: "c1" }),
    } as Response)

    await calendarApi.updateCalendar("c1", { name: "Updated" })
    expect(spy).toHaveBeenCalledWith("/api/v1/calendars/c1", expect.objectContaining({
      method: "PATCH",
    }))
  })

  it("deleteCalendar sends delete", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      status: 204,
      json: () => Promise.resolve({}),
    } as Response)

    await calendarApi.deleteCalendar("c1")
  })

  it("getEvents builds query string with params", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve([]),
    } as Response)

    await calendarApi.getEvents({
      from: "2026-05-01",
      to: "2026-05-31",
      calendar_ids: ["c1", "c2"],
    })
    const [url] = spy.mock.calls[0] as [string]
    expect(url).toContain("from=2026-05-01")
    expect(url).toContain("to=2026-05-31")
    expect(url).toContain("calendar_ids=c1%2Cc2")
  })

  it("getEvents with no params has no query string", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve([]),
    } as Response)

    await calendarApi.getEvents({})
    const [url] = spy.mock.calls[0] as [string]
    expect(url).toBe("/api/v1/events?")
  })

  it("createEvent posts event data", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ id: "e1", title: "Dinner" }),
    } as Response)

    const result = await calendarApi.createEvent({
      calendar_id: "c1" as any,
      title: "Dinner",
      start_at: "2026-05-01T18:00:00Z" as any,
    })
    expect(result.title).toBe("Dinner")
  })

  it("updateEvent patches event", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ id: "e1", title: "Updated" }),
    } as Response)

    const result = await calendarApi.updateEvent("e1", { title: "Updated" })
    expect(result.title).toBe("Updated")
  })

  it("deleteEvent sends delete", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      status: 204,
      json: () => Promise.resolve({}),
    } as Response)

    await calendarApi.deleteEvent("e1")
  })

  it("accepts all valid color values", async () => {
    for (const color of COLORS) {
      const spy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ id: "c1", name: "Test", color }),
      } as Response)
      const result = await calendarApi.createCalendar({ name: "Test", color })
      expect(result.color).toBe(color)
    }
  })

  it("deleteCalendar returns undefined on 204", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      status: 204,
      json: () => Promise.resolve({}),
    } as Response)

    const result = await calendarApi.deleteCalendar("c1")
    expect(result).toBeUndefined()
  })
})
