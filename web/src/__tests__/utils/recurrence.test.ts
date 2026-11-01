import { describe, it, expect } from "vitest"
import { expandRecurringEvent, expandEvents } from "@/utils/recurrence"
import type { Event } from "@/composables/useEvents"

function makeEvent(overrides: Partial<Event> = {}): Event {
  return {
    id: "evt-1",
    calendarId: "cal-1",
    title: "Standup",
    description: "",
    startAt: "2026-05-04T09:00:00.000Z",
    endAt: "2026-05-04T09:30:00.000Z",
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

const at = (iso: string) => new Date(iso)

describe("expandRecurringEvent", () => {
  it("returns the event as-is when there is no recurrence rule", () => {
    const ev = makeEvent()
    expect(expandRecurringEvent(ev, at("2026-05-01"), at("2026-06-01"))).toEqual([ev])
  })

  it("returns the event as-is for a rule without a usable frequency", () => {
    const ev = makeEvent({ recurrence: {} })
    expect(expandRecurringEvent(ev, at("2026-05-01"), at("2026-06-01"))).toEqual([ev])

    const unknown = makeEvent({ recurrence: { freq: "hourly", count: 3 } })
    expect(expandRecurringEvent(unknown, at("2026-05-01"), at("2026-06-01"))).toEqual([unknown])
  })

  it("returns the event as-is when the start date is invalid", () => {
    const ev = makeEvent({ startAt: "not-a-date", recurrence: { freq: "daily" } })
    expect(expandRecurringEvent(ev, at("2026-05-01"), at("2026-06-01"))).toEqual([ev])
  })

  it("expands weekly occurrences inside the window and keeps the duration", () => {
    const ev = makeEvent({
      recurrence: { freq: "weekly", count: 4 },
    })
    const out = expandRecurringEvent(ev, at("2026-05-04T00:00:00.000Z"), at("2026-05-25T23:59:59.000Z"))

    expect(out.map(o => o.id)).toEqual(["evt-1::0", "evt-1::1", "evt-1::2", "evt-1::3"])
    expect(out.map(o => o.startAt)).toEqual([
      "2026-05-04T09:00:00.000Z",
      "2026-05-11T09:00:00.000Z",
      "2026-05-18T09:00:00.000Z",
      "2026-05-25T09:00:00.000Z",
    ])
    expect(out.every(o => new Date(o.endAt!).getTime() - new Date(o.startAt).getTime() === 30 * 60_000)).toBe(true)
  })

  it("counts occurrences before the window so `count` caps the series", () => {
    // Daily, 5 occurrences, first one a day before the window: only the last
    // four belong in the window. A fast-forward must not grant extra pushes.
    const ev = makeEvent({
      startAt: "2026-05-03T09:00:00.000Z",
      endAt: "2026-05-03T09:30:00.000Z",
      recurrence: { freq: "daily", count: 5 },
    })
    const out = expandRecurringEvent(ev, at("2026-05-04T00:00:00.000Z"), at("2026-06-01T00:00:00.000Z"))

    expect(out.map(o => o.id)).toEqual(["evt-1::1", "evt-1::2", "evt-1::3", "evt-1::4"])
  })

  it("stops at the `until` bound", () => {
    const ev = makeEvent({ recurrence: { freq: "daily", until: "2026-05-06T09:00:00.000Z" } })
    const out = expandRecurringEvent(ev, at("2026-05-01"), at("2026-06-01"))

    expect(out.map(o => o.startAt.slice(0, 10))).toEqual(["2026-05-04", "2026-05-05", "2026-05-06"])
  })

  it("ignores an unparseable `until` and falls back to the window end", () => {
    const ev = makeEvent({ recurrence: { freq: "daily", until: "soon" } })
    const out = expandRecurringEvent(ev, at("2026-05-04"), at("2026-05-06T23:59:59.000Z"))

    expect(out).toHaveLength(3)
  })

  it("falls back to the base event when the series finished before the window", () => {
    const ev = makeEvent({ recurrence: { freq: "daily", count: 2 } })
    expect(expandRecurringEvent(ev, at("2026-06-01"), at("2026-07-01"))).toEqual([ev])
  })

  it("expands biweekly, monthly and yearly rules", () => {
    const biweekly = expandRecurringEvent(
      makeEvent({ startAt: "2026-01-15T09:00:00.000Z", endAt: null, recurrence: { freq: "biweekly", count: 4 } }),
      at("2026-02-01"), at("2026-03-01"),
    )
    expect(biweekly.map(o => o.startAt.slice(0, 10))).toEqual(["2026-02-12", "2026-02-26"])

    const monthly = expandRecurringEvent(
      makeEvent({ startAt: "2026-01-15T09:00:00.000Z", endAt: null, recurrence: { freq: "monthly", count: 3 } }),
      at("2026-01-01"), at("2026-04-01"),
    )
    expect(monthly.map(o => o.startAt.slice(0, 10))).toEqual(["2026-01-15", "2026-02-15", "2026-03-15"])

    const yearly = expandRecurringEvent(
      makeEvent({ startAt: "2026-01-15T09:00:00.000Z", endAt: null, recurrence: { freq: "yearly" } }),
      at("2026-01-01"), at("2028-01-01"),
    )
    expect(yearly.map(o => o.startAt.slice(0, 10))).toEqual(["2026-01-15", "2027-01-15"])

    // No end date → zero-length occurrences rather than NaN
    expect(biweekly.every(o => o.endAt === o.startAt)).toBe(true)
  })

  it("does not mutate the source event", () => {
    const ev = makeEvent({ recurrence: { freq: "weekly", count: 2 } })
    expandRecurringEvent(ev, at("2026-05-01"), at("2026-06-01"))
    expect(ev.id).toBe("evt-1")
    expect(ev.startAt).toBe("2026-05-04T09:00:00.000Z")
  })
})

describe("expandEvents", () => {
  it("leaves one-off events alone and expands recurring ones", () => {
    const oneOff = makeEvent({ id: "one-off" })
    const recurring = makeEvent({ id: "weekly", recurrence: { freq: "weekly", count: 2 } })

    const out = expandEvents([oneOff, recurring], at("2026-05-04"), at("2026-05-12"))

    expect(out.map(o => o.id)).toEqual(["one-off", "weekly::0", "weekly::1"])
  })
})
