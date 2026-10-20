import { describe, it, expect, vi } from "vitest"
import { useNotifications, _resetNotifications, START_GRACE_MS } from "@/composables/useNotifications"

describe("useNotifications", () => {
  it("starts with an empty queue", () => {
    const { notifications } = useNotifications()
    expect(notifications.value).toEqual([])
  })

  it("pushes a reminder payload into the queue", () => {
    const { notifications, push } = useNotifications()
    push({ event_id: "ev-1", title: "Soccer practice", start_at: "2030-06-01T18:00:00Z", minutes_before: 30 })
    expect(notifications.value).toHaveLength(1)
    expect(notifications.value[0]!.title).toBe("Soccer practice")
    expect(notifications.value[0]!.minutesBefore).toBe(30)
  })

  it("dedupes the same event occurrence", () => {
    const { notifications, push } = useNotifications()
    const payload = { event_id: "ev-1", title: "Soccer", start_at: "2030-06-01T18:00:00Z" }
    push(payload)
    push(payload)
    expect(notifications.value).toHaveLength(1)
  })

  it("caps the queue at three visible reminders", () => {
    const { notifications, push } = useNotifications()
    for (let i = 0; i < 5; i++) {
      push({ event_id: `ev-${i}`, title: `Event ${i}`, start_at: `2030-06-0${i + 1}T10:00:00Z` })
    }
    expect(notifications.value).toHaveLength(3)
    expect(notifications.value[0]!.title).toBe("Event 2")
    expect(notifications.value[2]!.title).toBe("Event 4")
  })

  it("dismisses a single reminder", () => {
    const { notifications, push, dismiss } = useNotifications()
    push({ event_id: "a", title: "A", start_at: "2030-06-01T10:00:00Z" })
    push({ event_id: "b", title: "B", start_at: "2030-06-01T11:00:00Z" })
    dismiss(notifications.value[0]!.id)
    expect(notifications.value.map(n => n.title)).toEqual(["B"])
  })

  it("falls back to a generic title for malformed payloads", () => {
    const { notifications, push } = useNotifications()
    push({})
    expect(notifications.value[0]!.title).toBe("Upcoming event")
  })

  it("auto-dismisses a reminder after the event has started", () => {
    vi.useFakeTimers()
    try {
      const { notifications, push } = useNotifications()
      push({ event_id: "ev-1", title: "Soccer", start_at: new Date(Date.now() + 5 * 60000).toISOString() })
      expect(notifications.value).toHaveLength(1)

      // Event starts — card stays through the grace period…
      vi.advanceTimersByTime(5 * 60000)
      expect(notifications.value).toHaveLength(1)

      // …then disappears.
      vi.advanceTimersByTime(START_GRACE_MS + 1000)
      expect(notifications.value).toHaveLength(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it("keeps an 'at start time' reminder visible during the grace period", () => {
    vi.useFakeTimers()
    try {
      const { notifications, push } = useNotifications()
      push({ event_id: "now", title: "Now", start_at: new Date(Date.now() + 30_000).toISOString() })
      expect(notifications.value).toHaveLength(1)

      vi.advanceTimersByTime(30_000 + START_GRACE_MS + 1000)
      expect(notifications.value).toHaveLength(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it("does not show reminders for events that started long ago", () => {
    const { notifications, push } = useNotifications()
    push({ event_id: "old", title: "Old", start_at: new Date(Date.now() - 10 * 60000).toISOString() })
    expect(notifications.value).toHaveLength(0)
  })

  it("clears pending expiry timers on reset", () => {
    vi.useFakeTimers()
    try {
      const { notifications, push } = useNotifications()
      push({ event_id: "ev-1", title: "Soccer", start_at: new Date(Date.now() + 60000).toISOString() })
      expect(notifications.value).toHaveLength(1)

      _resetNotifications()
      expect(notifications.value).toHaveLength(0)

      // Advancing past the original expiry must not resurrect or throw.
      vi.advanceTimersByTime(60000 + START_GRACE_MS + 1000)
      expect(notifications.value).toHaveLength(0)
    } finally {
      vi.useRealTimers()
    }
  })
})
