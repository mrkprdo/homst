import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { flushPromises } from "@vue/test-utils"
import { useEvents } from "@/composables/useEvents"

/* ── in-memory localStorage ─────────────────────────────────────────────────── */
const _ls = new Map<string, string>()
const _memLs: Storage = {
  get length() { return _ls.size },
  clear: () => _ls.clear(),
  getItem: (k: string) => _ls.get(k) ?? null,
  key: (i: number) => Array.from(_ls.keys())[i] ?? null,
  removeItem: (k: string) => { _ls.delete(k) },
  setItem: (k: string, v: string) => { _ls.set(k, String(v)) },
}
Object.defineProperty(window, "localStorage", { configurable: true, value: _memLs })
Object.defineProperty(globalThis, "localStorage", { configurable: true, value: _memLs })

const TOKEN_KEY = "homst:spotify-token"
const CODE_VERIFIER_KEY = "homst:spotify-code-verifier"
const CLIENT_ID_KEY = "homst:spotify-client-id"

const REAL_LOCATION = window.location
function stubLocation(overrides: Record<string, unknown> = {}) {
  Object.defineProperty(window, "location", {
    configurable: true,
    writable: true,
    value: {
      protocol: "http:", hostname: "homst", port: "", origin: "http://homst:80",
      href: "", search: "", pathname: "/",
      ...overrides,
    },
  })
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })

async function freshSpotify() {
  vi.resetModules()
  return await import("@/composables/useSpotify")
}

function storeToken(expiresInMs: number, partial: Record<string, unknown> = {}) {
  localStorage.setItem(TOKEN_KEY, JSON.stringify({
    accessToken: "access-token", refreshToken: "refresh-token",
    expiresAt: Date.now() + expiresInMs, ...partial,
  }))
}

beforeEach(() => {
  localStorage.clear()
  // Force the "not configured" branch unless a test overrides it
  vi.stubEnv("VITE_SPOTIFY_CLIENT_ID", "")
})

afterEach(() => {
  Object.defineProperty(window, "location", { configurable: true, writable: true, value: REAL_LOCATION })
  vi.unstubAllEnvs()
  vi.useRealTimers()
  vi.mocked(fetch).mockReset()
})

describe("useSpotify — storage & auth error paths", () => {
  it("falls back to a no-op storage when localStorage is unusable", async () => {
    const real = globalThis.localStorage
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {} })
    try {
      const sp = (await freshSpotify()).useSpotify()
      expect(sp.clientId.value).toBe("")
      expect(sp.needsConfig()).toBe(true)
      sp.setClientId("abc") // no-op store must not throw
      expect(sp.clientId.value).toBe("abc")
    } finally {
      Object.defineProperty(globalThis, "localStorage", { configurable: true, value: real })
    }
  })

  it("ignores a malformed stored token and an empty client id on connect", async () => {
    localStorage.setItem(TOKEN_KEY, "{not json")
    const sp = (await freshSpotify()).useSpotify()
    await sp.init()
    expect(sp.connected.value).toBe(false)

    // connect() without a configured client id does nothing
    sp.clientId.value = ""
    await sp.connect()
    expect(localStorage.getItem(CODE_VERIFIER_KEY)).toBeNull()
  })

  it("builds the redirect URI from the current origin when a port is present", async () => {
    stubLocation({ port: "3000", origin: "http://localhost:3000" })
    const sp = (await freshSpotify()).useSpotify()
    sp.clientId.value = "0123456789abcdef0123456789abcdef"
    await sp.connect()
    expect(String((window.location as any).href)).toContain("redirect_uri=http%3A%2F%2Flocalhost%3A3000")
  })

  it("surfaces a network failure during the OAuth callback", async () => {
    localStorage.setItem(CODE_VERIFIER_KEY, "verifier")
    stubLocation({ search: "?code=abc" })
    vi.mocked(fetch).mockRejectedValueOnce(new Error("offline"))

    const sp = (await freshSpotify()).useSpotify()
    await sp.init()
    expect(sp.error.value).toContain("Could not reach Spotify")
    expect(sp.connected.value).toBe(false)
  })

  it("adopts a server-configured client id when the browser has none", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ spotify_client_id: "0123456789abcdef0123456789abcdef" }))
    const sp = (await freshSpotify()).useSpotify()
    expect(sp.needsConfig()).toBe(true)
    await sp.init()
    expect(sp.clientId.value).toBe("0123456789abcdef0123456789abcdef")
    expect(sp.needsConfig()).toBe(false)
  })

  it("overrides a stale stored client id with the server value", async () => {
    localStorage.setItem(CLIENT_ID_KEY, "ffffffffffffffffffffffffffffffff")
    vi.mocked(fetch).mockResolvedValueOnce(json({ spotify_client_id: "0123456789abcdef0123456789abcdef" }))
    const sp = (await freshSpotify()).useSpotify()
    await sp.init()
    expect(sp.clientId.value).toBe("0123456789abcdef0123456789abcdef")
    expect(localStorage.getItem(CLIENT_ID_KEY)).toBe("0123456789abcdef0123456789abcdef")
  })

  it("refuses to start the OAuth flow with something that isn't a client id", async () => {
    const sp = (await freshSpotify()).useSpotify()
    sp.setClientId("not-a-client-id")
    await sp.connect()
    expect(sp.error.value).toContain("Spotify Client ID")
    expect(localStorage.getItem(CODE_VERIFIER_KEY)).toBeNull()
    expect(String((window.location as any).href)).not.toContain("accounts.spotify.com")
  })

  it("surfaces a denied authorization from the callback", async () => {
    stubLocation({ search: "?error=access_denied" })
    const sp = (await freshSpotify()).useSpotify()
    await sp.init()
    expect(sp.error.value).toBe("Spotify access was denied")
  })

  it("keeps polling state consistent for 204 / empty / missing-artwork responses", async () => {
    // 204 while nothing is playing
    storeToken(3_600_000)
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 204 }))
    let sp = (await freshSpotify()).useSpotify()
    await sp.init()
    await flushPromises()
    expect(sp.connected.value).toBe(true)
    expect(sp.currentTrack.value).toBeNull()
    sp.disconnect()

    // 200 without an item → no track info
    localStorage.clear()
    storeToken(3_600_000)
    vi.mocked(fetch).mockResolvedValueOnce(json({ progress_ms: 0 }))
    sp = (await freshSpotify()).useSpotify()
    await sp.init()
    await flushPromises()
    expect(sp.currentTrack.value).toBeNull()
    sp.disconnect()

    // item without artwork → empty album art
    localStorage.clear()
    storeToken(3_600_000)
    vi.mocked(fetch).mockResolvedValueOnce(json({
      progress_ms: 1_000,
      is_playing: true,
      item: {
        id: "tr", name: "Song", duration_ms: 60_000, artists: [{ name: "A" }],
        album: { images: [] },
      },
    }))
    sp = (await freshSpotify()).useSpotify()
    await sp.init()
    await flushPromises()
    expect(sp.currentTrack.value?.albumArt).toBe("")
    expect(sp.currentTrack.value?.artists).toBe("A")
    sp.disconnect()
  })

  it("clears an expired token when the refresh fails, then stops reporting a token", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] })
    storeToken(-1_000)
    // refresh response without an access token
    vi.mocked(fetch).mockResolvedValueOnce(json({}))
    const sp = (await freshSpotify()).useSpotify()
    await sp.init()
    await flushPromises()
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull()
    expect(sp.connected.value).toBe(false)

    // next poll finds no token at all
    vi.mocked(fetch).mockClear()
    await vi.advanceTimersByTimeAsync(5_000)
    await flushPromises()
    expect(sp.connected.value).toBe(false)
    expect(vi.mocked(fetch)).not.toHaveBeenCalled()
    sp.disconnect()
  })

  it("survives a throwing token refresh", async () => {
    vi.stubEnv("VITE_SPOTIFY_CLIENT_ID", "cid")
    storeToken(-1_000)
    vi.mocked(fetch).mockRejectedValueOnce(new Error("network"))

    const sp = (await freshSpotify()).useSpotify()
    await sp.init()
    await flushPromises()
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull()
    expect(sp.connected.value).toBe(false)
  })

  it("refreshes an expired token and reports the new access token", async () => {
    vi.stubEnv("VITE_SPOTIFY_CLIENT_ID", "cid")
    storeToken(-1_000)
    vi.mocked(fetch)
      .mockResolvedValueOnce(json({ access_token: "new-token", expires_in: 3600 }))
      .mockResolvedValueOnce(json({ progress_ms: 0 }))

    const sp = (await freshSpotify()).useSpotify()
    await sp.init()
    await flushPromises()
    expect(sp.connected.value).toBe(true)
    expect(JSON.parse(localStorage.getItem(TOKEN_KEY)!).accessToken).toBe("new-token")
    sp.disconnect()
  })

  it("treats a 401 as a lost session", async () => {
    storeToken(3_600_000)
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 401 }))
    const sp = (await freshSpotify()).useSpotify()
    await sp.init()
    await flushPromises()
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull()
    expect(sp.connected.value).toBe(false)
    sp.disconnect()
  })

  it("clamps elapsed playback time and stops polling on disconnect", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] })
    storeToken(3_600_000)
    vi.mocked(fetch).mockResolvedValue(json({
      progress_ms: 59_500, is_playing: true,
      item: {
        id: "tr", name: "Song", duration_ms: 60_000, artists: [{ name: "A" }],
        album: { images: [{ url: "art.jpg" }] },
      },
    }))
    const sp = (await freshSpotify()).useSpotify()
    await sp.init()
    await flushPromises()
    expect(sp.currentTrack.value?.albumArt).toBe("art.jpg")

    await vi.advanceTimersByTimeAsync(1_000)
    expect(sp.currentTrack.value?.progressMs).toBe(60_000) // clamped to duration

    sp.disconnect()
    vi.mocked(fetch).mockClear()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(vi.mocked(fetch)).not.toHaveBeenCalled()
  })

  it("clears the current track when playback stops", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] })
    storeToken(3_600_000)
    vi.mocked(fetch)
      .mockResolvedValueOnce(json({
        progress_ms: 1_000, is_playing: true,
        item: {
          id: "tr", name: "Song", duration_ms: 60_000, artists: [{ name: "A" }],
          album: { images: [{ url: "art.jpg" }] },
        },
      }))
      // Stopped: Spotify answers 200 with no item on the device.
      .mockResolvedValueOnce(json({ is_playing: false, item: null }))

    const sp = (await freshSpotify()).useSpotify()
    await sp.init()
    await flushPromises()
    expect(sp.currentTrack.value?.name).toBe("Song")

    await vi.advanceTimersByTimeAsync(5_000)
    await flushPromises()
    expect(sp.currentTrack.value).toBeNull()
    expect(sp.connected.value).toBe(true)
    sp.disconnect()
  })
})

describe("useEvents — calendar/holiday/event loading", () => {
  it("loads calendars, holidays and monthly events", async () => {
    const ev = useEvents()
    vi.mocked(fetch).mockImplementation((async (input: any) => {
      const url = String(input)
      if (url.includes("/calendars")) {
        return json([{ id: "c1", household_id: "h", name: "Home", color: "sage", source: "internal", feed_url: null, is_visible: true, created_by: null }])
      }
      if (url.includes("/holidays")) {
        return json([{ id: "h1", name: "New Year", date: "2026-01-01", created_at: "2026-01-01T00:00:00Z" }])
      }
      if (url.includes("/events")) {
        return json([{
          id: "e1", calendar_id: "c1", title: "Party", description: "",
          start_at: "2026-05-15T10:00:00Z", end_at: null, all_day: false,
          recurrence: null, source: "internal", external_uid: null, created_by: null,
          created_at: "", updated_at: "",
        }])
      }
      return json([])
    }) as any)

    await ev.ensureCalendars()
    expect(ev.calendars.value.map(c => c.id)).toContain("c1")

    await ev.ensureHolidays()
    expect(ev.calendars.value.map(c => c.id)).toContain("00000000-0000-0000-0000-000000000001")
    expect(ev.events.value.map(e => e.title)).toContain("New Year")

    await ev.ensureMonth(2026, 4)
    expect(ev.events.value.map(e => e.title)).toContain("Party")

    // second call is a no-op (already fetched)
    await ev.ensureMonth(2026, 4)
  })

  it("degrades to empty lists when the API rejects", async () => {
    const ev = useEvents()
    vi.mocked(fetch).mockRejectedValue(new Error("down"))

    await expect(ev.ensureCalendars()).resolves.toBeUndefined()
    await expect(ev.ensureHolidays()).resolves.toBeUndefined()
    await expect(ev.ensureMonth(2026, 0)).resolves.toBeUndefined()
    expect(ev.calendars.value).toHaveLength(0)
    expect(ev.events.value).toHaveLength(0)
  })

  it("resolves a default calendar id without a calendar service", async () => {
    const ev = useEvents()
    vi.mocked(fetch).mockRejectedValue(new Error("down"))
    await expect(ev.ensureDefaultCalendar()).resolves.toBe("default")
  })
})
