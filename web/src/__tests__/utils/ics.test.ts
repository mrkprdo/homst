import { describe, it, expect, afterEach, vi } from "vitest"
import { generateIcs, downloadIcs } from "@/utils/ics"
import type { Event } from "@/composables/useEvents"

function makeEvent(overrides: Partial<Event> = {}): Event {
  return {
    id: "evt-123",
    calendarId: "cal-1",
    title: "Team Meeting",
    description: "",
    startAt: "2026-05-10T14:00:00.000Z",
    endAt: "2026-05-10T15:00:00.000Z",
    allDay: false,
    recurrence: null,
    source: "internal",
    externalUid: null,
    createdBy: null,
    createdAt: "2026-05-01T00:00:00.000Z",
    updatedAt: "2026-05-01T00:00:00.000Z",
    ...overrides,
  }
}

describe("generateIcs", () => {
  it("produces valid VCALENDAR wrapper", () => {
    const ics = generateIcs(makeEvent())
    expect(ics).toContain("BEGIN:VCALENDAR")
    expect(ics).toContain("END:VCALENDAR")
    expect(ics).toContain("BEGIN:VEVENT")
    expect(ics).toContain("END:VEVENT")
    expect(ics).toContain("VERSION:2.0")
  })

  it("includes event title as SUMMARY", () => {
    const ics = generateIcs(makeEvent({ title: "Birthday Party" }))
    expect(ics).toContain("SUMMARY:Birthday Party")
  })

  it("uses event id as UID when no externalUid", () => {
    const ics = generateIcs(makeEvent({ id: "abc-456", externalUid: null }))
    expect(ics).toContain("UID:abc-456@homst")
  })

  it("uses externalUid when present", () => {
    const ics = generateIcs(makeEvent({ externalUid: "google-uid-xyz" }))
    expect(ics).toContain("UID:google-uid-xyz")
  })

  it("formats timed event DTSTART/DTEND in UTC", () => {
    const ics = generateIcs(makeEvent({
      startAt: "2026-05-10T14:00:00.000Z",
      endAt: "2026-05-10T15:00:00.000Z",
      allDay: false,
    }))
    expect(ics).toContain("DTSTART:20260510T140000Z")
    expect(ics).toContain("DTEND:20260510T150000Z")
  })

  it("formats all-day event with DATE value type", () => {
    const ics = generateIcs(makeEvent({
      startAt: "2026-05-10T00:00:00.000Z",
      endAt: "2026-05-10T00:00:00.000Z",
      allDay: true,
    }))
    expect(ics).toContain("DTSTART;VALUE=DATE:20260510")
    expect(ics).toContain("DTEND;VALUE=DATE:20260511")
  })

  it("all-day DTEND is +1 day per RFC 5545", () => {
    const ics = generateIcs(makeEvent({
      startAt: "2026-12-31T00:00:00.000Z",
      endAt: "2026-12-31T00:00:00.000Z",
      allDay: true,
    }))
    expect(ics).toContain("DTEND;VALUE=DATE:20270101")
  })

  it("all-day DTEND falls back to startAt +1 when endAt is null", () => {
    const ics = generateIcs(makeEvent({
      startAt: "2026-05-10T00:00:00.000Z",
      endAt: null,
      allDay: true,
    }))
    expect(ics).toContain("DTEND;VALUE=DATE:20260511")
  })

  it("omits DTEND for timed event with no endAt", () => {
    const ics = generateIcs(makeEvent({ endAt: null, allDay: false }))
    expect(ics).not.toContain("DTEND")
  })

  it("includes DESCRIPTION when present", () => {
    const ics = generateIcs(makeEvent({ description: "Bring snacks" }))
    expect(ics).toContain("DESCRIPTION:Bring snacks")
  })

  it("omits DESCRIPTION when empty", () => {
    const ics = generateIcs(makeEvent({ description: "" }))
    expect(ics).not.toContain("DESCRIPTION")
  })

  it("escapes special characters in title", () => {
    const ics = generateIcs(makeEvent({ title: "Meeting; Room 1, Floor 2" }))
    expect(ics).toContain("SUMMARY:Meeting\\; Room 1\\, Floor 2")
  })

  it("escapes backslashes in description", () => {
    const ics = generateIcs(makeEvent({ description: "Path: C:\\Users\\test" }))
    expect(ics).toContain("DESCRIPTION:Path: C:\\\\Users\\\\test")
  })

  it("escapes newlines in description", () => {
    const ics = generateIcs(makeEvent({ description: "Line 1\nLine 2" }))
    expect(ics).toContain("DESCRIPTION:Line 1\\nLine 2")
  })

  it("uses CRLF line endings throughout", () => {
    const ics = generateIcs(makeEvent())
    expect(ics).toContain("\r\n")
    const lines = ics.split("\r\n")
    expect(lines.length).toBeGreaterThan(5)
  })

  it("folds lines longer than 75 chars", () => {
    const longTitle = "A".repeat(100)
    const ics = generateIcs(makeEvent({ title: longTitle }))
    const lines = ics.split("\r\n")
    for (const line of lines) {
      expect(line.length).toBeLessThanOrEqual(75)
    }
  })
})

describe("downloadIcs", () => {
  const originalCreate = (URL as unknown as { createObjectURL?: unknown }).createObjectURL
  const originalRevoke = (URL as unknown as { revokeObjectURL?: unknown }).revokeObjectURL

  afterEach(() => {
    ;(URL as unknown as { createObjectURL?: unknown }).createObjectURL = originalCreate
    ;(URL as unknown as { revokeObjectURL?: unknown }).revokeObjectURL = originalRevoke
    vi.restoreAllMocks()
  })

  it("creates a calendar blob, clicks a download link, and revokes the URL", () => {
    const createObjectURL = vi.fn(() => "blob:mock-url")
    const revokeObjectURL = vi.fn()
    ;(URL as unknown as { createObjectURL: unknown }).createObjectURL = createObjectURL
    ;(URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = revokeObjectURL

    let anchor: HTMLAnchorElement | null = null
    const realCreateElement = document.createElement.bind(document)
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      const el = realCreateElement(tag)
      if (tag === "a") anchor = el as HTMLAnchorElement
      return el
    })
    // Prevent jsdom's "navigation not implemented" noise.
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {})

    downloadIcs(makeEvent({ title: "Team Meeting!" }))

    expect(createObjectURL).toHaveBeenCalledTimes(1)
    expect(anchor).not.toBeNull()
    expect(anchor!.href).toContain("blob:mock-url")
    expect(anchor!.download).toBe("Team_Meeting_.ics")
    expect(clickSpy).toHaveBeenCalledTimes(1)
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:mock-url")
  })
})
