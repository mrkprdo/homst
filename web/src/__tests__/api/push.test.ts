import { describe, it, expect, beforeEach, vi } from "vitest"
import { pushApi } from "@/api/push"

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } })

describe("pushApi", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it("fetches the VAPID public key", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ key: "ABC" })))
    const result = await pushApi.vapidPublicKey()
    expect(result.key).toBe("ABC")
    const [url] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]!
    expect(String(url)).toContain("/push/vapid-public-key")
  })

  it("posts a subscription", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ message: "subscribed" })))
    await pushApi.subscribe({
      endpoint: "https://push.example/1",
      keys: { p256dh: "p", auth: "a" },
    })
    const [url, options] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]!
    expect(String(url)).toContain("/push/subscribe")
    expect(options.method).toBe("POST")
    expect(JSON.parse(options.body)).toEqual({
      endpoint: "https://push.example/1",
      keys: { p256dh: "p", auth: "a" },
    })
  })

  it("posts an unsubscribe by endpoint", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ message: "unsubscribed" })))
    await pushApi.unsubscribe("https://push.example/1")
    const [url, options] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]!
    expect(String(url)).toContain("/push/unsubscribe")
    expect(JSON.parse(options.body)).toEqual({ endpoint: "https://push.example/1" })
  })
})
