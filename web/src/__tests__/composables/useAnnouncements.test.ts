import { describe, it, expect, vi } from "vitest"
import {
  useAnnouncements,
  _resetAnnouncements,
  isAnnouncementActive,
  type Announcement,
} from "@/composables/useAnnouncements"

const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  })

function announcement(overrides: Partial<Announcement> = {}): Announcement {
  return {
    id: "a1",
    householdId: "h1",
    message: "Dinner is ready",
    createdBy: null,
    authorName: null,
    createdAt: "2026-06-01T18:00:00Z",
    expiresAt: "2026-06-01T18:30:00Z",
    ...overrides,
  }
}

function apiAnnouncement(overrides: Record<string, unknown> = {}) {
  return {
    id: "a1",
    household_id: "h1",
    message: "Dinner is ready",
    created_by: null,
    author_name: null,
    created_at: "2026-06-01T18:00:00Z",
    expires_at: "2026-06-01T18:30:00Z",
    ...overrides,
  }
}

describe("useAnnouncements", () => {
  it("loads announcements newest first", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json([
      apiAnnouncement({ id: "old", created_at: "2026-06-01T17:00:00Z" }),
      apiAnnouncement({ id: "new", created_at: "2026-06-01T19:00:00Z" }),
    ]))

    const { announcements, ensureLoaded } = useAnnouncements()
    await ensureLoaded()

    expect(announcements.value.map(a => a.id)).toEqual(["new", "old"])
  })

  it("hides expired announcements and announcements dismissed on this screen", () => {
    const { upsertAnnouncement, visible, dismiss } = useAnnouncements()
    upsertAnnouncement(announcement({ id: "live", expiresAt: null }))
    upsertAnnouncement(announcement({ id: "expired", expiresAt: "2026-06-01T17:00:00Z" }))
    upsertAnnouncement(announcement({ id: "dismissed", expiresAt: null }))

    dismiss("dismissed")

    const now = new Date("2026-06-01T18:00:00Z").getTime()
    expect(visible(now).map(a => a.id)).toEqual(["live"])
  })

  it("persists local dismissals in localStorage", () => {
    const { upsertAnnouncement, dismiss, visible } = useAnnouncements()
    upsertAnnouncement(announcement({ id: "a1", expiresAt: null }))
    dismiss("a1")

    expect(localStorage.getItem("homst-dismissed-announcements")).toContain("a1")
    expect(visible()).toEqual([])
  })

  it("sends an announcement and adds it to the store", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json(apiAnnouncement({ id: "new" })))

    const { send, announcements } = useAnnouncements()
    const created = await send({
      message: "Dinner is ready",
      createdBy: "m1",
      durationMinutes: 30,
      sendPush: false,
    })

    const [, options] = vi.mocked(fetch).mock.calls[0]!
    expect(JSON.parse(options?.body as string)).toEqual({
      message: "Dinner is ready",
      created_by: "m1",
      duration_minutes: 30,
      send_push: false,
    })
    expect(created.id).toBe("new")
    expect(announcements.value.map(a => a.id)).toEqual(["new"])
  })

  it("does not add an announcement when sending fails", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ detail: "Server exploded" }), {
        status: 500,
        headers: { "content-type": "application/json" },
      }),
    )

    const { send, announcements } = useAnnouncements()
    await expect(send({ message: "Hello" })).rejects.toThrow("Server exploded")
    expect(announcements.value).toEqual([])
  })

  it("removes an announcement from the API and the store", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ message: "Announcement removed" }))

    const { upsertAnnouncement, remove, announcements } = useAnnouncements()
    upsertAnnouncement(announcement({ id: "a1" }))
    await remove("a1")

    const [url, options] = vi.mocked(fetch).mock.calls[0]!
    expect(url).toContain("/announcements/a1")
    expect(options?.method).toBe("DELETE")
    expect(announcements.value).toEqual([])
  })

  it("treats announcements without an expiry as active", () => {
    expect(isAnnouncementActive(announcement({ expiresAt: null }))).toBe(true)
    expect(
      isAnnouncementActive(announcement({ expiresAt: "2020-01-01T00:00:00Z" })),
    ).toBe(false)
  })

  it("resets the store and dismissal cache", async () => {
    const { upsertAnnouncement, announcements, dismiss } = useAnnouncements()
    upsertAnnouncement(announcement())
    dismiss("a1")

    _resetAnnouncements()

    expect(announcements.value).toEqual([])
    expect(localStorage.getItem("homst-dismissed-announcements")).toBeNull()
  })

  it("keeps the existing list when loading fails", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error("offline"))

    const { upsertAnnouncement, announcements, ensureLoaded, error } = useAnnouncements()
    upsertAnnouncement(announcement({ id: "kept" }))
    await ensureLoaded()

    expect(announcements.value.map(a => a.id)).toEqual(["kept"])
    expect(error.value).toBe("Could not load announcements")
  })
})
