import { describe, it, expect, beforeEach, vi } from "vitest"
import { api, isServerUnreachable } from "@/api/client"

describe("api client", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it("GET returns parsed JSON", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ data: "hello" }),
    } as Response)

    const result = await api.get("/test")
    expect(result).toEqual({ data: "hello" })
  })

  it("POST sends body as JSON", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ id: "1" }),
    } as Response)

    await api.post("/test", { name: "foo" })
    expect(fetchSpy).toHaveBeenCalledWith("/api/v1/test", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ name: "foo" }),
    }))
  })

  it("PATCH sends body as JSON", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ ok: true }),
    } as Response)

    await api.patch("/test/1", { name: "bar" })
    expect(fetchSpy).toHaveBeenCalledWith("/api/v1/test/1", expect.objectContaining({
      method: "PATCH",
      body: JSON.stringify({ name: "bar" }),
    }))
  })

  it("DELETE sends no body", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      status: 204,
      json: () => Promise.resolve({}),
    } as Response)

    await api.delete("/test/1")
    expect(fetchSpy).toHaveBeenCalledWith("/api/v1/test/1", expect.objectContaining({
      method: "DELETE",
    }))
  })

  it("throws on non-ok response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: () => Promise.resolve({ detail: "Not found" }),
    } as Response)

    await expect(api.get("/missing")).rejects.toThrow("Not found")
  })

  it("throws with status message when no detail", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: () => Promise.resolve({}),
    } as Response)

    await expect(api.get("/error")).rejects.toThrow("Request failed: 500")
  })

  it("includes credentials", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({}),
    } as Response)

    await api.get("/test")
    expect(fetchSpy).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      credentials: "include",
    }))
  })

  it("marks the server unreachable on a network error", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new TypeError("Failed to fetch"))
    const error = await api.get("/network-error").catch((err) => err)
    expect(isServerUnreachable(error)).toBe(true)
    if (isServerUnreachable(error)) {
      expect(error.message).toContain("HOMST local server is out of reach")
    }
  })

  it("marks the server unreachable on a request timeout", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new DOMException("The operation timed out", "TimeoutError"))
    const error = await api.get("/timeout").catch((err) => err)
    expect(isServerUnreachable(error)).toBe(true)
  })

  it("sends Content-Type header by default", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({}),
    } as Response)

    await api.get("/test")
    expect(fetchSpy).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      headers: expect.objectContaining({ "Content-Type": "application/json" }),
    }))
  })

  it("DELETE returns undefined on 204", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      status: 204,
      json: () => Promise.resolve({}),
    } as Response)

    const result = await api.delete("/test/1")
    expect(result).toBeUndefined()
  })
})
