import { describe, it, expect, vi, afterEach } from "vitest"
import { scheduleIdle } from "@/lib/idle"

afterEach(() => {
  delete (window as any).requestIdleCallback
  delete (window as any).cancelIdleCallback
  vi.useRealTimers()
})

describe("scheduleIdle", () => {
  it("uses requestIdleCallback when available and cancels it", () => {
    const task = vi.fn()
    const cancelIdle = vi.fn()
    ;(window as any).requestIdleCallback = (callback: IdleRequestCallback) => {
      callback({ didTimeout: false, timeRemaining: () => 10 } as IdleDeadline)
      return 42
    }
    ;(window as any).cancelIdleCallback = cancelIdle

    const cancel = scheduleIdle(task)

    expect(task).toHaveBeenCalledTimes(1)
    cancel()
    expect(cancelIdle).toHaveBeenCalledWith(42)
  })

  it("falls back to a timeout and clears it", () => {
    vi.useFakeTimers()
    const task = vi.fn()

    const cancel = scheduleIdle(task, 3000, 1500)
    vi.advanceTimersByTime(1499)
    expect(task).not.toHaveBeenCalled()

    cancel()
    vi.advanceTimersByTime(10)
    expect(task).not.toHaveBeenCalled()
  })
})
