import { describe, it, expect, beforeEach, afterEach } from "vitest"
import {
  useNotificationIntent,
  _resetNotificationIntent,
} from "@/composables/useNotificationIntent"

describe("useNotificationIntent", () => {
  const originalUrl = window.location.href

  beforeEach(() => {
    _resetNotificationIntent()
  })

  afterEach(() => {
    window.history.replaceState({}, "", originalUrl)
    _resetNotificationIntent()
  })

  it("returns an event intent once and removes it from the URL", () => {
    window.history.replaceState({}, "", "/?event=ev-1&event_start=1767225600")

    const { take } = useNotificationIntent()
    expect(take()).toEqual({ type: "event", id: "ev-1", startAt: "1767225600" })
    expect(window.location.search).toBe("")

    // A reload or a second component must not reopen the same intent.
    expect(take()).toBeNull()
  })

  it("returns an announcement intent", () => {
    window.history.replaceState({}, "", "/?announcement=ann-1")

    const { take } = useNotificationIntent()
    expect(take()).toEqual({ type: "announcement", id: "ann-1" })
    expect(window.location.search).toBe("")
  })

  it("carries the stored push id and handles a plain push tap", () => {
    window.history.replaceState({}, "", "/?announcement=ann-1&push=push-9")
    expect(useNotificationIntent().take()).toEqual({
      type: "announcement",
      id: "ann-1",
      pushId: "push-9",
    })

    _resetNotificationIntent()
    window.history.replaceState({}, "", "/?push=push-10")
    expect(useNotificationIntent().take()).toEqual({ type: "push", id: "push-10" })
    expect(window.location.search).toBe("")
  })

  it("keeps unrelated query parameters when consuming an intent", () => {
    window.history.replaceState({}, "", "/?theme=dark&event=ev-2")

    const { take } = useNotificationIntent()
    expect(take()?.id).toBe("ev-2")
    expect(window.location.search).toBe("?theme=dark")
  })

  it("returns null without a notification intent", () => {
    window.history.replaceState({}, "", "/?theme=dark")
    const { take } = useNotificationIntent()
    expect(take()).toBeNull()
  })
})
