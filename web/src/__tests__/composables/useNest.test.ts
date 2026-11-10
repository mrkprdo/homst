import { beforeEach, describe, expect, it, vi } from "vitest"
import { nestApi, type NestTemperatures } from "@/api/nest"
import { useNest, _resetNest } from "@/composables/useNest"

const CONNECTED: NestTemperatures = {
  configured: true,
  authType: "nest",
  connected: true,
  rooms: [{
    id: "kryptonite.1",
    name: "Basement",
    room: "Basement",
    temperatureC: 19.5,
    humidity: null,
    kind: "sensor",
    online: true,
    active: false,
  }],
  updatedAt: "2026-01-01T00:00:00Z",
  error: null,
}

describe("useNest", () => {
  beforeEach(() => {
    _resetNest()
    vi.restoreAllMocks()
  })

  it("normalizes partial and malformed responses", async () => {
    const api = useNest()
    vi.spyOn(nestApi, "getTemperatures").mockResolvedValueOnce([] as unknown as NestTemperatures)
    await api.refresh()
    expect(api.status.value).toEqual({
      configured: false,
      authType: null,
      connected: false,
      rooms: [],
      updatedAt: null,
      error: null,
    })

    vi.spyOn(nestApi, "getTemperatures").mockResolvedValueOnce({
      configured: true,
      authType: "bad",
      rooms: "nope",
      error: 42,
    } as unknown as NestTemperatures)
    await api.refresh()
    expect(api.status.value?.authType).toBeNull()
    expect(api.status.value?.rooms).toEqual([])
    expect(api.status.value?.error).toBeNull()
  })

  it("applies a status returned by the settings card", () => {
    const api = useNest()
    api.applyStatus(CONNECTED)
    expect(api.status.value?.connected).toBe(true)
    expect(api.status.value?.rooms).toHaveLength(1)
  })

  it("reports the loading state only until the first result", async () => {
    const api = useNest()
    let resolve!: (value: NestTemperatures) => void
    vi.spyOn(nestApi, "getTemperatures").mockReturnValueOnce(
      new Promise<NestTemperatures>((done) => { resolve = done }),
    )

    const pending = api.refresh()
    expect(api.loading.value).toBe(true)
    resolve(CONNECTED)
    await pending
    expect(api.loading.value).toBe(false)
    expect(api.status.value?.connected).toBe(true)

    vi.spyOn(nestApi, "getTemperatures").mockResolvedValueOnce(CONNECTED)
    await api.refresh(true)
    expect(api.loading.value).toBe(false)
  })

  it("coalesces overlapping refreshes", async () => {
    const api = useNest()
    let resolve!: (value: NestTemperatures) => void
    const spy = vi.spyOn(nestApi, "getTemperatures").mockReturnValueOnce(
      new Promise<NestTemperatures>((done) => { resolve = done }),
    )

    const first = api.refresh()
    const second = api.refresh()
    expect(spy).toHaveBeenCalledTimes(1)

    resolve(CONNECTED)
    await Promise.all([first, second])
    expect(api.status.value?.connected).toBe(true)
  })

  it("surfaces API and non-Error failures", async () => {
    const api = useNest()
    vi.spyOn(nestApi, "getTemperatures").mockRejectedValueOnce(new Error("Nest rejected"))
    await api.refresh()
    expect(api.error.value).toBe("Nest rejected")

    vi.spyOn(nestApi, "getTemperatures").mockRejectedValueOnce("offline")
    await api.refresh()
    expect(api.error.value).toBe("Could not load indoor temperatures.")
    expect(api.loading.value).toBe(false)
  })

  it("polls once per minute for every consumer and stops after the last one", async () => {
    vi.useFakeTimers()
    try {
      const api = useNest()
      const spy = vi.spyOn(nestApi, "getTemperatures").mockResolvedValue(CONNECTED)

      api.startAutoRefresh()
      api.startAutoRefresh()
      await vi.advanceTimersByTimeAsync(60_000)
      expect(spy).toHaveBeenCalledTimes(1)

      api.stopAutoRefresh()
      await vi.advanceTimersByTimeAsync(60_000)
      expect(spy).toHaveBeenCalledTimes(2)

      api.stopAutoRefresh()
      await vi.advanceTimersByTimeAsync(60_000)
      expect(spy).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })
})
