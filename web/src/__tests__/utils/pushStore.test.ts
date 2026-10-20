import { describe, it, expect } from "vitest"
import { listStoredPushes, matchStoredPush, type StoredPush } from "@/lib/pushStore"

function push(overrides: Partial<StoredPush> = {}): StoredPush {
  return {
    id: "push-1",
    title: "Dinner is ready",
    body: "Come to the kitchen",
    url: "/?announcement=ann-1",
    received_at: 1_767_225_600_000,
    ...overrides,
  }
}

describe("pushStore", () => {
  it("matches an announcement by its deep link", () => {
    const items = [
      push({ id: "push-2", url: "/?event=ev-1&event_start=10" }),
      push(),
    ]
    expect(matchStoredPush(items, { type: "announcement", id: "ann-1" })?.id).toBe("push-1")
  })

  it("matches an event by id and occurrence start", () => {
    const items = [
      push({ id: "older", url: "/?event=ev-1&event_start=10" }),
      push({ id: "newer", url: "/?event=ev-1&event_start=20" }),
    ]
    expect(
      matchStoredPush(items, { type: "event", id: "ev-1", startAt: "20" })?.id,
    ).toBe("newer")
  })

  it("prefers the exact stored push id", () => {
    const items = [
      push({ id: "push-a", url: "/?event=ev-1&event_start=10" }),
      push({ id: "push-b", url: "/?event=ev-1&event_start=10" }),
    ]
    expect(
      matchStoredPush(items, {
        type: "event",
        id: "ev-1",
        startAt: "10",
        pushId: "push-b",
      })?.id,
    ).toBe("push-b")
  })

  it("matches a plain push tap", () => {
    const items = [push({ id: "push-plain", url: "/" })]
    expect(matchStoredPush(items, { type: "push", id: "push-plain" })?.id).toBe("push-plain")
  })

  it("returns an empty list when IndexedDB is unavailable", async () => {
    await expect(listStoredPushes()).resolves.toEqual([])
  })
})
