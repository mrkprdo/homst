import { describe, it, expect, beforeEach, vi } from "vitest"
import { announcementsApi } from "@/api/announcements"

const mockAnnouncement = {
  id: "a1",
  household_id: "h1",
  message: "Dinner is ready",
  created_by: "m1",
  author_name: "Alice",
  created_at: "2026-06-01T18:00:00Z",
  expires_at: "2026-06-01T18:30:00Z",
}

describe("announcementsApi", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it("lists announcements and maps snake_case fields", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve([mockAnnouncement]),
    } as Response)

    const result = await announcementsApi.list()
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({
      id: "a1",
      householdId: "h1",
      message: "Dinner is ready",
      createdBy: "m1",
      authorName: "Alice",
      createdAt: "2026-06-01T18:00:00Z",
      expiresAt: "2026-06-01T18:30:00Z",
    })
  })

  it("treats a malformed list response as empty", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({}),
    } as Response)

    await expect(announcementsApi.list()).resolves.toEqual([])
  })

  it("posts the create payload and maps the result", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockAnnouncement),
    } as Response)

    const result = await announcementsApi.create({
      message: "Dinner is ready",
      created_by: "m1",
      duration_minutes: 30,
      send_push: false,
    })

    const [url, options] = vi.mocked(fetch).mock.calls[0]!
    expect(url).toContain("/announcements")
    expect(options?.method).toBe("POST")
    expect(JSON.parse(options?.body as string)).toEqual({
      message: "Dinner is ready",
      created_by: "m1",
      duration_minutes: 30,
      send_push: false,
    })
    expect(result.authorName).toBe("Alice")
  })

  it("removes an announcement by id", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ message: "Announcement removed" }),
    } as Response)

    await announcementsApi.remove("a1")
    const [url, options] = vi.mocked(fetch).mock.calls[0]!
    expect(url).toContain("/announcements/a1")
    expect(options?.method).toBe("DELETE")
  })
})
