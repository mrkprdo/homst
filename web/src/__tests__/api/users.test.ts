import { describe, it, expect, beforeEach, vi } from "vitest"
import { usersApi } from "@/api/users"

const mockMember = {
  id: "u1", household_id: "h1", name: "Alice",
  avatar_url: null, role: "member", joined_at: "2026-05-01T00:00:00Z",
}

describe("usersApi", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it("getMembers returns mapped members", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve([mockMember]),
    } as Response)

    const result = await usersApi.getMembers()
    expect(result).toHaveLength(1)
    expect(result[0]!.name).toBe("Alice")
    expect(result[0]!.householdId).toBe("h1")
  })

  it("createMember posts and returns mapped member", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockMember),
    } as Response)

    const result = await usersApi.createMember({ name: "Alice" })
    expect(result.name).toBe("Alice")
    expect(result.householdId).toBe("h1")
  })

  it("updateMember patches and returns mapped member", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ ...mockMember, role: "admin" }),
    } as Response)

    const result = await usersApi.updateMember("u1", { role: "admin" })
    expect(result.role).toBe("admin")
  })

  it("removeMember sends delete", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true, status: 200,
      json: () => Promise.resolve({ message: "Member deleted" }),
    } as Response)
    await usersApi.removeMember("u1")
  })

  it("returns avatar_url when present", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ ...mockMember, avatar_url: "https://example.com/avatar.png" }),
    } as Response)
    const result = await usersApi.updateMember("u1", { avatar_url: "https://example.com/avatar.png" })
    expect(result.avatarUrl).toBe("https://example.com/avatar.png")
  })

  it("returns null avatar_url when not set", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockMember),
    } as Response)
    const result = await usersApi.createMember({ name: "Bob" })
    expect(result.avatarUrl).toBeNull()
  })

  it("returns non-admin role from API", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ ...mockMember, role: "admin" }),
    } as Response)
    const result = await usersApi.updateMember("u1", { role: "admin" })
    expect(result.role).toBe("admin")
  })

  it("removeMember handles 204 response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true, status: 204,
      json: () => Promise.resolve({}),
    } as Response)
    const result = await usersApi.removeMember("u2")
    expect(result).toBeUndefined()
  })
})
