import { describe, it, expect, vi } from "vitest"
import {
  _resetServerReachability,
  checkServerReachable,
  markServerReachable,
  markServerUnreachable,
  useServerReachability,
} from "@/composables/useServerReachability"

describe("useServerReachability", () => {
  it("marks the server reachable or unreachable for every consumer", () => {
    const { serverReachable } = useServerReachability()
    expect(serverReachable.value).toBe(true)

    markServerUnreachable()
    expect(serverReachable.value).toBe(false)

    markServerReachable()
    expect(serverReachable.value).toBe(true)
  })

  it("probes /api/health and treats any response as reachable", async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 200 }))

    await expect(checkServerReachable()).resolves.toBe(true)
    expect(String(fetchMock.mock.calls[0]![0])).toBe("/api/health")
  })

  it("reports unreachable when the health request cannot connect", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new TypeError("Failed to fetch"))
    _resetServerReachability()

    await expect(checkServerReachable()).resolves.toBe(false)
    expect(useServerReachability().serverReachable.value).toBe(false)
  })
})
