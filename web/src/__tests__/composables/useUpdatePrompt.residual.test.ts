import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import type { SystemJob, SystemStatus } from "@/api/system"
import { systemApi } from "@/api/system"
import {
  _resetUpdatePrompt,
  offerUpdatePrompt,
  refreshUpdatePrompt,
  updatePromptStarting,
  useUpdatePrompt,
} from "@/composables/useUpdatePrompt"

function status(overrides: Record<string, unknown> = {}): SystemStatus {
  return {
    current: { version: "0.2.0", commit: "c1", image: null, tag: null, digest: null, channel: "stable" },
    latest: { major: false, html_url: null },
    update_prompt: { version: "0.3.0", dismissed: false },
    job: null,
    ...overrides,
  } as unknown as SystemStatus
}

function job(overrides: Record<string, unknown> = {}): SystemJob {
  return {
    id: "job-1",
    state: "pulling",
    version: "0.3.0",
    latest: true,
    message: "Downloading",
    progress: { percent: 50, bytes: 5, total: 10 },
    error: null,
    from_version: "0.2.0",
    to_version: "0.3.0",
    started_at: "2026-01-01T00:00:00Z",
    finished_at: null,
    ...overrides,
  } as SystemJob
}

let statusMock: any
let jobMock: any
let installMock: any
let dismissMock: any

async function offerAndInstall() {
  offerUpdatePrompt({ version: "0.3.0" })
  updatePromptStarting("0.3.0")
}

const realLocation = window.location

beforeEach(() => {
  vi.restoreAllMocks()
  _resetUpdatePrompt()
  vi.useFakeTimers()
  statusMock = vi.spyOn(systemApi, "getStatus").mockResolvedValue(status())
  jobMock = vi.spyOn(systemApi, "getJob")
  installMock = vi.spyOn(systemApi, "install").mockResolvedValue(job())
  dismissMock = vi.spyOn(systemApi, "dismissPrompt")
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  Object.defineProperty(window, "location", {
    configurable: true,
    writable: true,
    value: realLocation,
  })
  _resetUpdatePrompt()
})
describe("useUpdatePrompt residual", () => {
  it("refines an already-offered version and can be cleared", () => {
    offerUpdatePrompt({ version: "0.3.0", major: false })
    expect(useUpdatePrompt().prompt.value?.major).toBe(false)

    offerUpdatePrompt({ version: "0.3.0", major: true, html_url: "https://example.com" })
    expect(useUpdatePrompt().prompt.value).toMatchObject({
      version: "0.3.0",
      major: true,
      htmlUrl: "https://example.com",
    })

    _resetUpdatePrompt()
    expect(useUpdatePrompt().prompt.value).toBeNull()
  })

  it("shows a failed install after a refresh and keeps an active one visible", async () => {
    statusMock.mockResolvedValueOnce(status())
    await refreshUpdatePrompt()
    await offerAndInstall()
    expect(useUpdatePrompt().installing.value).toBe(true)

    statusMock.mockResolvedValueOnce(
      status({ job: job({ state: "failed", error: "Disk full" }) }),
    )
    const refreshed = await refreshUpdatePrompt()
    expect(refreshed).toBe(true)
    expect(statusMock).toHaveBeenCalledTimes(2)
    expect(useUpdatePrompt().installing.value).toBe(false)

    // An active job with no prompt keeps the installing card, not a clear.
    offerUpdatePrompt({ version: "0.4.0" })
    await offerAndInstall()
    statusMock.mockResolvedValueOnce(
      status({ update_prompt: { version: null }, job: job({ state: "verifying" }) }),
    )
    await refreshUpdatePrompt()
    expect(useUpdatePrompt().installing.value).toBe(true)
  })

  it("keeps an active job visible when no prompt is offered", async () => {
    updatePromptStarting("0.3.0")
    statusMock.mockResolvedValueOnce(
      status({
        update_prompt: { version: null },
        job: job({ state: "verifying", version: "", to_version: "" }),
      }),
    )
    await expect(refreshUpdatePrompt()).resolves.toBe(true)
    expect(useUpdatePrompt().installing.value).toBe(true)
  })

  it("polls through an empty, active, and failed job", async () => {
    await offerAndInstall()
    expect(useUpdatePrompt().installing.value).toBe(true)

    jobMock.mockResolvedValueOnce({ job: null })
    await vi.advanceTimersByTimeAsync(2000)

    jobMock.mockResolvedValueOnce({ job: job({ state: "pulling" }) })
    await vi.advanceTimersByTimeAsync(2000)

    jobMock.mockResolvedValueOnce({ job: job({ state: "rolled_back", error: "bad image" }) })
    await vi.advanceTimersByTimeAsync(2000)
    expect(useUpdatePrompt().error.value).toBe("bad image")
    expect(useUpdatePrompt().installing.value).toBe(false)
  })

  it("reloads once after a long restart", async () => {
    const reload = vi.fn()
    Object.defineProperty(window, "location", {
      configurable: true,
      writable: true,
      value: { reload },
    })
    sessionStorage.removeItem("homst:update:timeout-reloaded")
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"))

    await offerAndInstall()
    expect(useUpdatePrompt().installing.value).toBe(true)
    jobMock.mockRejectedValueOnce(new Error("restarting"))
    await vi.advanceTimersByTimeAsync(2000)

    vi.setSystemTime(new Date("2026-01-01T00:04:01Z"))
    jobMock.mockRejectedValueOnce(new Error("still restarting"))
    await vi.advanceTimersByTimeAsync(2000)
    expect(reload).toHaveBeenCalled()
    expect(useUpdatePrompt().installing.value).toBe(false)
  })

  it("explains the timeout instead of reloading when the marker exists", async () => {
    const reload = vi.fn()
    Object.defineProperty(window, "location", {
      configurable: true,
      writable: true,
      value: { reload },
    })
    sessionStorage.setItem("homst:update:timeout-reloaded", "0.3.0")
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"))

    await offerAndInstall()
    jobMock.mockRejectedValueOnce(new Error("restarting"))
    await vi.advanceTimersByTimeAsync(2000)

    vi.setSystemTime(new Date("2026-01-01T00:05:00Z"))
    jobMock.mockRejectedValueOnce(new Error("still restarting"))
    await vi.advanceTimersByTimeAsync(2000)
    expect(reload).not.toHaveBeenCalled()
    expect(useUpdatePrompt().error.value).toContain("did not come back")
  })

  it("explains a timeout when session storage is unavailable", async () => {
    const reload = vi.fn()
    Object.defineProperty(window, "location", {
      configurable: true,
      writable: true,
      value: { reload },
    })
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"))
    await offerAndInstall()
    jobMock.mockRejectedValueOnce(new Error("restarting"))
    await vi.advanceTimersByTimeAsync(2000)

    const nativeGet = Storage.prototype.getItem
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(function (this: Storage, key: string) {
      if (key === "homst:update:timeout-reloaded") throw new Error("denied")
      return nativeGet.call(this, key)
    })
    vi.setSystemTime(new Date("2026-01-01T00:05:00Z"))
    jobMock.mockRejectedValueOnce(new Error("still restarting"))
    await vi.advanceTimersByTimeAsync(2000)
    expect(reload).not.toHaveBeenCalled()
    expect(useUpdatePrompt().error.value).toContain("did not come back")
  })

  it("reports accept and decline failures, including non-Error throws", async () => {
    offerUpdatePrompt({ version: "0.3.0" })
    installMock.mockRejectedValueOnce(new Error("Updater busy"))
    await useUpdatePrompt().accept()
    expect(useUpdatePrompt().error.value).toBe("Updater busy")

    installMock.mockRejectedValueOnce("nope")
    await useUpdatePrompt().accept()
    expect(useUpdatePrompt().error.value).toBe("Could not start the update.")

    _resetUpdatePrompt()
    offerUpdatePrompt({ version: "0.3.0" })
    dismissMock.mockRejectedValueOnce(new Error("Cannot dismiss"))
    await useUpdatePrompt().decline()
    expect(useUpdatePrompt().error.value).toBe("Cannot dismiss")

    dismissMock.mockRejectedValueOnce("nope")
    await useUpdatePrompt().decline()
    expect(useUpdatePrompt().error.value).toBe("Could not dismiss the reminder.")
  })

  it("does not reload when session storage blocks the release marker", async () => {
    statusMock.mockResolvedValueOnce(status())
    await refreshUpdatePrompt()

    const nativeGet = Storage.prototype.getItem
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(function (this: Storage, key: string) {
      if (key === "homst:update:reloaded-for") throw new Error("denied")
      return nativeGet.call(this, key)
    })
    statusMock.mockResolvedValueOnce(
      status({ current: { ...status().current, version: "0.3.0", commit: "c2" } }),
    )
    await refreshUpdatePrompt()
    expect(useUpdatePrompt().prompt.value).toBeNull()
  })
})
