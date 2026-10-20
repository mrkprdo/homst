import { describe, it, expect, beforeEach, vi } from "vitest"
import { householdApi } from "@/api/household"

describe("householdApi", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it("getSettings returns settings object", async () => {
    const mockSettings = { houseName: "My Home", address: "123 Main St", isComplete: true }
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockSettings),
    } as Response)

    const result = await householdApi.getSettings()
    expect(result.houseName).toBe("My Home")
    expect(result.address).toBe("123 Main St")
    expect(result.isComplete).toBe(true)
  })

  it("getSettings returns empty object when no settings saved", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({}),
    } as Response)

    const result = await householdApi.getSettings()
    expect(result).toEqual({})
  })

  it("updateSettings sends patch with settings", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ message: "Settings updated" }),
    } as Response)

    await householdApi.updateSettings({ houseName: "New Home", address: "456 Oak Ave" })
    expect(spy).toHaveBeenCalledWith("/api/v1/household/settings", expect.objectContaining({
      method: "PATCH",
      body: JSON.stringify({ settings: { houseName: "New Home", address: "456 Oak Ave" } }),
    }))
  })

  it("getMembers returns members array", async () => {
    const mockMembers = [
      { id: "m1", household_id: "h1", name: "Alice", avatar_url: null, role: "member", joined_at: "2026-01-01T00:00:00Z" },
      { id: "m2", household_id: "h1", name: "Bob", avatar_url: null, role: "member", joined_at: "2026-01-01T00:00:00Z" },
    ]
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockMembers),
    } as Response)

    const result = await householdApi.getMembers()
    expect(result).toHaveLength(2)
    expect(result[0]!.name).toBe("Alice")
    expect(result[1]!.name).toBe("Bob")
  })

  it("getMembers returns empty array when no members", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve([]),
    } as Response)

    const result = await householdApi.getMembers()
    expect(result).toEqual([])
  })

  it("updateSettings ignores invalid field names", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ message: "Settings updated" }),
    } as Response)

    await householdApi.updateSettings({ invalidField: "should be ignored" } as any)
    const callBody = JSON.parse(spy.mock.calls[0]![1]!.body as string)
    expect(callBody.settings).toHaveProperty("invalidField")
  })
})
