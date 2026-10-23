import { describe, it, expect, vi, afterEach } from "vitest"
import { flushPromises } from "@vue/test-utils"
import { api, isServerUnreachable } from "@/api/client"
import { systemApi } from "@/api/system"
import { readHouseholdComplete } from "@/lib/householdCache"
import { animate, setLowPower } from "@/lib/motion"
import {
  _resetPushStore,
  listStoredPushes,
  matchStoredPush,
  MAX_STORED_PUSHES,
  PUSH_DB_NAME,
  PUSH_STORE,
  type StoredPush,
} from "@/lib/pushStore"
import { useAnnouncements, _resetAnnouncements } from "@/composables/useAnnouncements"
import { usePush } from "@/composables/usePush"
import { useSpotify } from "@/composables/useSpotify"
import { checkServerReachable } from "@/composables/useServerReachability"
import {
  applyHouseholdSettings,
  refreshFromServer,
  useSettings,
} from "@/composables/useSettings"

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  _resetPushStore()
  setLowPower(false)
  _resetAnnouncements()
})

/* ══════════════════════════════════════════════════════════════════════
   api/client upload failures
   ══════════════════════════════════════════════════════════════════════ */

describe("api/client upload", () => {
  it("rethrows aborts and maps network failures to ServerUnreachableError", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new DOMException("aborted", "AbortError"))
    await expect(api.upload("/photos", new FormData())).rejects.toMatchObject({
      name: "AbortError",
    })

    vi.mocked(fetch).mockRejectedValueOnce(new TypeError("Failed to fetch"))
    const error = await api.upload("/photos", new FormData()).catch((err) => err)
    expect(isServerUnreachable(error)).toBe(true)
  })
})

/* ══════════════════════════════════════════════════════════════════════
   api/system error branches
   ══════════════════════════════════════════════════════════════════════ */

describe("api/system", () => {
  it("uses the server detail, then a status fallback", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ detail: "Out of date" }, 409))
    await expect(systemApi.getStatus()).rejects.toThrow("Out of date")

    vi.mocked(fetch).mockResolvedValueOnce(json({}, 500))
    await expect(systemApi.getJob()).rejects.toThrow("Request failed: 500")
  })

  it("calls the retry-rollback endpoint with the confirmation header", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ id: "job-1", state: "rolled_back" }))
    const job = await systemApi.retryRollback()
    expect(job.state).toBe("rolled_back")
    expect(String(vi.mocked(fetch).mock.calls[0]![0])).toContain("/system/recovery/retry-rollback")
    expect((vi.mocked(fetch).mock.calls[0]![1] as RequestInit).headers).toMatchObject({
      "X-HOMST-Update": "1",
    })
  })
})

/* ══════════════════════════════════════════════════════════════════════
   householdCache: storage denied
   ══════════════════════════════════════════════════════════════════════ */

describe("householdCache", () => {
  it("treats denied storage as an incomplete household", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementationOnce(() => {
      throw new Error("denied")
    })
    expect(readHouseholdComplete()).toBe(false)
  })
})

/* ══════════════════════════════════════════════════════════════════════
   motion: numeric string transforms and the stub chain
   ══════════════════════════════════════════════════════════════════════ */

describe("motion low-power stubs", () => {
  it("formats numeric strings with their CSS unit and exposes the stub chain", () => {
    setLowPower(true)
    const el = document.createElement("div")
    const animation = animate(el, { translateX: "10", rotate: 45, opacity: [0, 1] })
    expect(el.style.transform).toContain("translateX(10px)")
    expect(el.style.transform).toContain("rotate(45deg)")
    expect((animation as any).complete()).toBe(animation)
  })
})

/* ══════════════════════════════════════════════════════════════════════
   pushStore: a fake IndexedDB that covers open/upgrade/read/error paths
   ══════════════════════════════════════════════════════════════════════ */

interface FakeDbOptions {
  rows?: unknown[]
  block?: boolean
  failOpen?: boolean
  failRead?: boolean
}

function installFakeIndexedDb(options: FakeDbOptions = {}) {
  const upgraded: string[] = []

  const fake = {
    open(name: string) {
      const request: any = { error: new Error("denied") }
      queueMicrotask(() => {
        request.result = {
          objectStoreNames: { contains: () => false },
          createObjectStore: (store: string) => {
            upgraded.push(store)
            return { createIndex: vi.fn() }
          },
          transaction: () => ({
            objectStore: () => ({
              getAll: () => {
                const read: any = { error: new Error("read failed") }
                queueMicrotask(() => {
                  if (options.failRead) read.onerror?.()
                  else {
                    read.result = options.rows
                    read.onsuccess?.()
                  }
                })
                return read
              },
            }),
          }),
        }
        request.onupgradeneeded?.()
        if (options.block) request.onblocked?.()
        else if (options.failOpen) request.onerror?.()
        else request.onsuccess?.()
      })
      expect(name).toBe(PUSH_DB_NAME)
      return request
    },
  }

  vi.stubGlobal("indexedDB", fake)
  return { upgraded }
}

function push(overrides: Partial<StoredPush> = {}): StoredPush {
  return {
    id: "push-1",
    title: "Dinner",
    body: "Ready",
    url: "/?announcement=a1",
    received_at: 10,
    ...overrides,
  }
}

describe("pushStore IndexedDB", () => {
  it("creates the object store on upgrade and returns sorted, filtered rows", async () => {
    const { upgraded } = installFakeIndexedDb({
      rows: [
        push({ id: "old", received_at: 1 }),
        push({ id: "new", received_at: 9 }),
        { id: 3, received_at: "bad" },
      ],
    })

    const rows = await listStoredPushes()
    expect(upgraded).toEqual([PUSH_STORE])
    expect(rows.map((row) => row.id)).toEqual(["new", "old"])

    await expect(listStoredPushes(1)).resolves.toHaveLength(1)
  })

  it("returns an empty list when opening or reading fails", async () => {
    installFakeIndexedDb({ failOpen: true })
    await expect(listStoredPushes()).resolves.toEqual([])

    installFakeIndexedDb({ block: true })
    await expect(listStoredPushes()).resolves.toEqual([])

    installFakeIndexedDb({ failRead: true })
    await expect(listStoredPushes()).resolves.toEqual([])
  })

  it("derives a limit and matches fallback taps", () => {
    expect(MAX_STORED_PUSHES).toBeGreaterThan(0)
    expect(matchStoredPush([], null)).toBeNull()
    expect(matchStoredPush([push()], null)?.id).toBe("push-1")
    expect(
      matchStoredPush([push({ url: "not a url" })], { type: "announcement", id: "a1" }),
    ).toBeNull()
  })
})

/* ══════════════════════════════════════════════════════════════════════
   useAnnouncements: in-place updates and corrupt storage
   ══════════════════════════════════════════════════════════════════════ */

function announcement(id: string, createdAt = "2026-06-01T18:00:00Z") {
  return {
    id,
    householdId: "h1",
    message: `message ${id}`,
    createdBy: null,
    authorName: null,
    createdAt,
    expiresAt: null,
  }
}

describe("useAnnouncements residual", () => {
  it("replaces an existing announcement and keeps newest-first order", () => {
    const store = useAnnouncements()
    store.upsertAnnouncement(announcement("a", "2026-06-01T17:00:00Z"))
    store.upsertAnnouncement(announcement("a", "2026-06-01T20:00:00Z"))
    store.upsertAnnouncement(announcement("b", "2026-06-01T18:00:00Z"))
    expect(store.announcements.value.map((item) => item.id)).toEqual(["a", "b"])
    expect(store.announcements.value[0]!.message).toBe("message a")
  })
})
/* ══════════════════════════════════════════════════════════════════════
   usePush: environment and non-Error failure paths
   ══════════════════════════════════════════════════════════════════════ */

function setServiceWorker(value: unknown) {
  Object.defineProperty(navigator, "serviceWorker", { configurable: true, value })
}

afterEach(() => {
  vi.unstubAllGlobals()
  delete (navigator as any).serviceWorker
  delete (window as any).PushManager
  delete (window as any).Notification
  delete (window as any).isSecureContext
})

describe("usePush residual", () => {
  it("reports no browser environment", async () => {
    vi.stubGlobal("window", undefined)
    const push = usePush()
    await push.refresh()
    expect(push.supported.value).toBe(false)
    expect(push.supportDetail.value).toContain("no browser environment")
  })

  it("resets subscription state when registration lookup throws", async () => {
    ;(window as any).PushManager = function PushManager() {}
    ;(window as any).Notification = { permission: "granted" }
    setServiceWorker({ getRegistration: vi.fn().mockRejectedValue(new Error("no sw")) })
    const push = usePush()
    await push.refresh()
    expect(push.subscribed.value).toBe(false)
  })

  it("fails enable without support and uses a fallback for non-Error throws", async () => {
    vi.stubGlobal("window", undefined)
    const push = usePush()
    await expect(push.enable()).resolves.toBe(false)
    expect(push.error.value).toContain("isn't supported")

    vi.unstubAllGlobals()
    ;(window as any).PushManager = function PushManager() {}
    ;(window as any).Notification = {
      permission: "granted",
      requestPermission: vi.fn().mockRejectedValue("nope"),
    }
    setServiceWorker({ getRegistration: vi.fn(), ready: Promise.resolve({}) })
    const enabled = usePush()
    await expect(enabled.enable()).resolves.toBe(false)
    expect(enabled.error.value).toBe("Could not enable push")
  })

  it("uses a fallback when disabling throws a non-Error", async () => {
    setServiceWorker({ getRegistration: vi.fn().mockRejectedValue("nope") })
    const push = usePush()
    await expect(push.disable()).resolves.toBe(false)
    expect(push.error.value).toBe("Could not turn off push")
  })
})

/* ══════════════════════════════════════════════════════════════════════
   useServerReachability: no browser
   ══════════════════════════════════════════════════════════════════════ */

describe("useServerReachability without a browser", () => {
  it("assumes reachable when fetch is unavailable", async () => {
    vi.stubGlobal("fetch", undefined)
    await expect(checkServerReachable()).resolves.toBe(true)
  })
})

/* ══════════════════════════════════════════════════════════════════════
   useSpotify: an expired token whose refresh is refused is discarded
   ══════════════════════════════════════════════════════════════════════ */

describe("useSpotify token refresh", () => {
  it("drops an expired token when Spotify returns no access token", async () => {
    const spotify = useSpotify()
    spotify.setClientId("0123456789abcdef0123456789abcdef")
    localStorage.setItem(
      "homst:spotify-token",
      JSON.stringify({ accessToken: "old", refreshToken: "refresh", expiresAt: 0 }),
    )
    vi.mocked(fetch).mockResolvedValueOnce(json({}))
    try {
      await spotify.init()
      await flushPromises()
      expect(localStorage.getItem("homst:spotify-token")).toBeNull()
    } finally {
      spotify.disconnect()
      localStorage.removeItem("homst:spotify-token")
    }
  })
})

/* ══════════════════════════════════════════════════════════════════════
   useSettings: preset fallback and widget-layout resync
   ══════════════════════════════════════════════════════════════════════ */

describe("useSettings residual", () => {
  it("falls back to the preset accent when the stored one is unavailable", () => {
    const settings = useSettings()
    settings.updateAccentColor("sage")
    applyHouseholdSettings({ accentColor: "sage", themePreset: "futur" })
    expect(settings.accentColor.value).toBe("mint")
  })

  it("announces a server widget layout and refreshes photos", async () => {
    const settings = useSettings()
    settings.photos.value = []
    const heard = vi.fn()
    window.addEventListener("homst:widget-layout-updated", heard)

    vi.mocked(fetch)
      .mockResolvedValueOnce(
        json({
          isComplete: true,
          houseName: "Home",
          widgetLayout: [{ id: "datetime", col: 0, row: 0, w: 1, h: 1 }],
        }),
      )
      .mockResolvedValueOnce(json([{ id: "p1", url: "/p1", selected: true }]))

    try {
      await refreshFromServer()
      expect(heard).toHaveBeenCalledTimes(1)
      expect(settings.photos.value).toHaveLength(1)
    } finally {
      window.removeEventListener("homst:widget-layout-updated", heard)
    }
  })
})

/* ----------------------------------------------------------------------
   module-init failures run last: vi.resetModules() replaces the registry
   ---------------------------------------------------------------------- */

describe("module init with denied storage", () => {
  it("starts with no announcement dismissals when localStorage throws", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied")
    })
    vi.resetModules()
    const fresh = await import("@/composables/useAnnouncements")
    expect(fresh.useAnnouncements().visible()).toEqual([])
  })
})
