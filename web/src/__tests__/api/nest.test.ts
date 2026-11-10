import { beforeEach, describe, expect, it, vi } from "vitest"
import { nestApi } from "@/api/nest"

function ok(body: unknown) {
  return { ok: true, json: () => Promise.resolve(body) } as Response
}

describe("nestApi", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it("loads temperatures and can force a refresh", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(ok({ configured: true }))

    await nestApi.getTemperatures()
    await nestApi.getTemperatures(true)

    expect(spy).toHaveBeenNthCalledWith(1, "/api/v1/nest/temperatures", expect.any(Object))
    expect(spy).toHaveBeenNthCalledWith(
      2,
      "/api/v1/nest/temperatures?refresh=true",
      expect.any(Object),
    )
  })

  it("saves Google and legacy Nest credentials", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(ok({ configured: true }))

    await nestApi.saveCredentials({
      account_type: "google",
      issue_token: "https://accounts.google.com/o/oauth2/iframerpc?action=issueToken",
      cookies: "SID=abc",
    })
    await nestApi.saveCredentials({ account_type: "nest", access_token: "legacy" })

    expect(JSON.parse(spy.mock.calls[0]![1]!.body as string)).toEqual({
      account_type: "google",
      issue_token: "https://accounts.google.com/o/oauth2/iframerpc?action=issueToken",
      cookies: "SID=abc",
    })
    expect(JSON.parse(spy.mock.calls[1]![1]!.body as string)).toEqual({
      account_type: "nest",
      access_token: "legacy",
    })
  })

  it("clears stored credentials", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(ok({ message: "Nest disconnected" }))

    expect(await nestApi.clearCredentials()).toEqual({ message: "Nest disconnected" })
    expect(spy).toHaveBeenCalledWith("/api/v1/nest/credentials", expect.objectContaining({
      method: "DELETE",
    }))
  })
})
