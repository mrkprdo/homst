import { describe, it, expect, beforeEach, vi } from "vitest"
import { notificationsApi } from "@/api/notifications"

describe("notificationsApi", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it("sendTest posts the payload and returns per-channel results", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ results: { hud: "sent to the display" } }), {
        status: 200, headers: { "content-type": "application/json" },
      }),
    ))
    const result = await notificationsApi.sendTest({ channels: ["hud"] })
    expect(result.results.hud).toBe("sent to the display")
    const [url, options] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]!
    expect(url).toContain("/notifications/test")
    expect(options.method).toBe("POST")
    expect(JSON.parse(options.body)).toEqual({ channels: ["hud"] })
  })

  it("sendTest defaults to an empty payload", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ results: {} }), {
        status: 200, headers: { "content-type": "application/json" },
      }),
    ))
    await notificationsApi.sendTest()
    const [, options] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]!
    expect(JSON.parse(options.body)).toEqual({})
  })
})
