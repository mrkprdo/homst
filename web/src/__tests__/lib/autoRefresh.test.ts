import { describe, it, expect, vi, afterEach } from "vitest"
import {
  AUTO_REFRESH_STALE_MS,
  isClientStale,
  reloadClientPage,
  startAutoRefreshTimer,
} from "@/lib/autoRefresh"

describe("auto refresh", () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it("treats a client as stale after 15 minutes without interaction", () => {
    const lastInteraction = 1_000
    expect(isClientStale(lastInteraction, lastInteraction + AUTO_REFRESH_STALE_MS - 1)).toBe(false)
    expect(isClientStale(lastInteraction, lastInteraction + AUTO_REFRESH_STALE_MS)).toBe(true)
    expect(isClientStale(lastInteraction, lastInteraction + AUTO_REFRESH_STALE_MS + 1)).toBe(true)
  })

  it("reloads only when the client is stale", () => {
    vi.useFakeTimers()
    let stale = false
    const reload = vi.fn()
    const timer = startAutoRefreshTimer(15, () => stale, reload)

    vi.advanceTimersByTime(15 * 60_000 - 1)
    expect(reload).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    expect(reload).not.toHaveBeenCalled()

    stale = true
    vi.advanceTimersByTime(15 * 60_000)
    expect(reload).toHaveBeenCalledTimes(1)

    clearInterval(timer)
  })

  it("falls back to a one-hour interval for invalid values", () => {
    vi.useFakeTimers()
    const reload = vi.fn()
    const timer = startAutoRefreshTimer(Number.NaN, () => true, reload)

    vi.advanceTimersByTime(60 * 60_000)
    expect(reload).toHaveBeenCalledTimes(1)

    clearInterval(timer)
  })

  it("reloads through the supplied window location", () => {
    const reload = vi.fn()
    reloadClientPage({ reload })
    expect(reload).toHaveBeenCalledTimes(1)
  })
})
