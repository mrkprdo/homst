import { describe, it, expect, vi, afterEach } from "vitest"
import { urlBase64ToUint8Array, usePush } from "@/composables/usePush"

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })

function setServiceWorker(value: unknown) {
  Object.defineProperty(navigator, "serviceWorker", { configurable: true, value })
}

function installBrowser(registration: unknown, permission: NotificationPermission = "granted") {
  setServiceWorker({
    getRegistration: vi.fn().mockResolvedValue(registration),
    ready: Promise.resolve(registration),
  })
  ;(window as any).PushManager = function PushManager() {}
  ;(window as any).Notification = {
    permission,
    requestPermission: vi.fn().mockResolvedValue(permission),
  }
}

afterEach(() => {
  delete (navigator as any).serviceWorker
  delete (window as any).PushManager
  delete (window as any).Notification
  delete (window as any).isSecureContext
})

describe("urlBase64ToUint8Array", () => {
  it("decodes a base64url VAPID key to bytes", () => {
    expect(Array.from(urlBase64ToUint8Array("AQAB"))).toEqual([1, 0, 1])
  })
})

describe("usePush", () => {
  it("reports unsupported when the browser has no service worker", async () => {
    delete (navigator as any).serviceWorker
    const push = usePush()
    await push.refresh()
    expect(push.supported.value).toBe(false)
    expect(push.subscribed.value).toBe(false)
  })

  it("explains when the page isn't a secure context", async () => {
    installBrowser({})
    ;(window as any).isSecureContext = false
    const push = usePush()
    await push.refresh()
    expect(push.supported.value).toBe(false)
    expect(push.supportDetail.value).toContain("secure context")
  })

  it("names the missing API when the browser lacks PushManager", async () => {
    installBrowser({})
    delete (window as any).PushManager
    const push = usePush()
    await push.refresh()
    expect(push.supported.value).toBe(false)
    expect(push.supportDetail.value).toContain("PushManager")
  })

  it("reflects an existing subscription on refresh", async () => {
    installBrowser({ pushManager: { getSubscription: vi.fn().mockResolvedValue({ endpoint: "x" }) } })
    const push = usePush()
    await push.refresh()
    expect(push.supported.value).toBe(true)
    expect(push.subscribed.value).toBe(true)
  })

  it("subscribes this device and registers it with the server", async () => {
    const fakeSub = {
      endpoint: "https://push.example/1",
      toJSON: () => ({ keys: { p256dh: "P", auth: "A" } }),
    }
    const registration = {
      pushManager: {
        getSubscription: vi.fn().mockResolvedValue(null),
        subscribe: vi.fn().mockResolvedValue(fakeSub),
      },
    }
    installBrowser(registration)

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ key: "AQAB" }))
      .mockResolvedValueOnce(json({ message: "subscribed" }))
    vi.stubGlobal("fetch", fetchMock)

    const push = usePush()
    const ok = await push.enable()
    expect(ok).toBe(true)
    expect(push.subscribed.value).toBe(true)

    const subscribeArgs = registration.pushManager.subscribe.mock.calls[0]![0]
    expect(subscribeArgs.userVisibleOnly).toBe(true)
    expect(Array.from(subscribeArgs.applicationServerKey)).toEqual([1, 0, 1])

    const [url, options] = fetchMock.mock.calls[1]!
    expect(String(url)).toContain("/push/subscribe")
    expect(JSON.parse(options.body)).toMatchObject({
      endpoint: "https://push.example/1",
      keys: { p256dh: "P", auth: "A" },
    })
  })

  it("does not subscribe when permission is denied", async () => {
    const registration = { pushManager: { subscribe: vi.fn() } }
    installBrowser(registration, "denied")

    const push = usePush()
    const ok = await push.enable()
    expect(ok).toBe(false)
    expect(push.subscribed.value).toBe(false)
    expect(push.error.value).toContain("blocked")
    expect(registration.pushManager.subscribe).not.toHaveBeenCalled()
  })

  it("unsubscribes and forgets the device", async () => {
    const fakeSub = { endpoint: "https://push.example/1", unsubscribe: vi.fn().mockResolvedValue(true) }
    setServiceWorker({
      getRegistration: vi.fn().mockResolvedValue({
        pushManager: { getSubscription: vi.fn().mockResolvedValue(fakeSub) },
      }),
    })
    const fetchMock = vi.fn().mockResolvedValue(json({ message: "unsubscribed" }))
    vi.stubGlobal("fetch", fetchMock)

    const push = usePush()
    push.subscribed.value = true
    const ok = await push.disable()

    expect(ok).toBe(true)
    expect(push.subscribed.value).toBe(false)
    expect(fakeSub.unsubscribe).toHaveBeenCalled()
    expect(String(fetchMock.mock.calls[0]![0])).toContain("/push/unsubscribe")
  })
})
