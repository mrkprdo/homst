import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { defineComponent, h, nextTick } from "vue"
import { mount } from "@vue/test-utils"
import { useEvents } from "@/composables/useEvents"
import { useTasks } from "@/composables/useTasks"
import { useMembers } from "@/composables/useMembers"
import { useUi } from "@/composables/useUi"
import { useSettings, applyHouseholdSettings, isApplyingRemoteSettings } from "@/composables/useSettings"
import { useNowIndicator } from "@/composables/useNowIndicator"
import { useWeather } from "@/composables/useWeather"

describe("useEvents", () => {
  it("upserts/removes events and calendars, cascades calendar delete", () => {
    const ev = useEvents()
    const baseEv = {
      id: "e1", calendarId: "c1", title: "T1", description: "",
      startAt: "2026-05-01T00:00:00Z", endAt: null, allDay: false, recurrence: null,
      source: "internal" as const, externalUid: null, createdBy: null,
      createdAt: "", updatedAt: "",
    }
    ev.upsertEvent(baseEv)
    ev.upsertEvent({ ...baseEv, title: "T1-updated" })
    expect(ev.events.value).toHaveLength(1)
    expect(ev.events.value[0]!.title).toBe("T1-updated")

    const cal = {
      id: "c1", householdId: "h", name: "Main", color: "sage",
      source: "internal", feedUrl: null, isVisible: true, createdBy: null,
    }
    ev.upsertCalendar(cal)
    ev.upsertCalendar({ ...cal, name: "Main2" })
    expect(ev.calendars.value[0]!.name).toBe("Main2")

    ev.removeEvent("nonexistent")
    expect(ev.events.value).toHaveLength(1)
    ev.removeCalendar("c1")
    expect(ev.calendars.value).toHaveLength(0)
    expect(ev.events.value).toHaveLength(0)
  })

  it("ensureDefaultCalendar returns existing real cal, creates Personal if only holiday cal, or falls back to 'default'", async () => {
    const ev = useEvents()
    // Seed only the holiday sentinel calendar
    ev.upsertCalendar({
      id: "00000000-0000-0000-0000-000000000001", householdId: "h", name: "Holidays",
      color: "sky", source: "internal", feedUrl: null, isVisible: true, createdBy: null,
    })
    // First call: getCalendars returns [], createCalendar fails → "default"
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }))
      .mockRejectedValueOnce(new Error("fail"))
    expect(await ev.ensureDefaultCalendar()).toBe("default")

    // Second call: calendars already fetched, createCalendar succeeds
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({
        id: "c-new", household_id: "h", name: "Personal", color: "sage",
        source: "internal", feed_url: null, is_visible: true, created_by: null,
      }), { status: 201 }),
    )
    expect(await ev.ensureDefaultCalendar()).toBe("c-new")
    // Third call finds existing real calendar
    expect(await ev.ensureDefaultCalendar()).toBe("c-new")
  })

  it("ensureHolidays populates holiday events and prefetchAround / refresh handle year boundaries", async () => {
    const ev = useEvents()
    vi.mocked(fetch).mockImplementation(async (url) => {
      const u = String(url)
      if (u.includes("/holidays")) {
        return new Response(JSON.stringify([
          { id: "h1", household_id: "h", date: "2026-01-01", name: "NYD", local_name: null, country_code: "US", province: null, created_at: "2026-01-01T00:00:00Z" },
        ]), { status: 200 })
      }
      return new Response(JSON.stringify([]), { status: 200 })
    })

    await ev.prefetchAround(2026, 0)  // Jan → prev is Dec 2025
    await ev.prefetchAround(2026, 11) // Dec → next is Jan 2027
    expect(ev.events.value.some(e => e.title === "NYD")).toBe(true)

    await ev.refresh()
    expect(ev.loading.value).toBe(false)
  })
})

describe("useTasks", () => {
  it("upserts/removes tasks & lists, sorts computed buckets, and refreshes", async () => {
    const tk = useTasks()
    const base = {
      id: "t1", listId: "l1", title: "A", description: "", assigneeId: null,
      startAt: null, endAt: null, status: "todo" as const, priority: "medium" as const,
      position: 2, createdBy: null, createdAt: "", updatedAt: "",
    }
    tk.upsertTask(base)
    tk.upsertTask({ ...base, id: "t2", position: 1 })
    tk.upsertTask({ ...base, id: "t1", title: "A-edited" })
    tk.upsertTask({ ...base, id: "t3", status: "doing", position: 0 })
    tk.upsertTask({ ...base, id: "t4", status: "done", position: 0 })

    expect(tk.todos.value.map(t => t.id)).toEqual(["t2", "t1"])
    expect(tk.doing.value).toHaveLength(1)
    expect(tk.done.value).toHaveLength(1)

    tk.upsertList({ id: "l1", householdId: "h", name: "L1", color: "sage", position: 2 })
    tk.upsertList({ id: "l2", householdId: "h", name: "L2", color: "sage", position: 1 })
    tk.upsertList({ id: "l1", householdId: "h", name: "L1-up", color: "sage", position: 2 })
    expect(tk.sortedLists.value.map(l => l.id)).toEqual(["l2", "l1"])

    tk.removeTask("t2")
    expect(tk.todos.value).toHaveLength(1)
    tk.removeList("l1")
    expect(tk.tasks.value).toHaveLength(0)

    vi.mocked(fetch).mockRejectedValueOnce(new Error("net")).mockRejectedValueOnce(new Error("net"))
    await tk.ensureLoaded()
    await tk.ensureLoaded() // cached no-op
    await tk.refresh()
  })
})

describe("useMembers", () => {
  it("upserts members with fallback color, preserves color on update, removes, and refreshes", async () => {
    const mb = useMembers()
    mb.upsertMember({
      id: "m1", householdId: "h", name: "Alice", avatarUrl: null,
      color: "", role: "admin", joinedAt: "",
    })
    expect(mb.members.value[0]!.color).toBeTruthy()
    const assignedColor = mb.members.value[0]!.color

    mb.upsertMember({
      id: "m1", householdId: "h", name: "Alice2", avatarUrl: null,
      color: "", role: "admin", joinedAt: "",
    })
    expect(mb.members.value[0]!.color).toBe(assignedColor)

    mb.removeMember("m1")
    expect(mb.members.value).toHaveLength(0)

    vi.mocked(fetch).mockRejectedValueOnce(new Error("offline"))
    await mb.ensureLoaded()
    await mb.ensureLoaded() // cached
    await mb.refresh()
  })
})

describe("useUi", () => {
  it("manages panel, drawer open/close, and closeGuard", async () => {
    vi.useFakeTimers()
    try {
      const ui = useUi()
      ui.setPanel("calendar")
      expect(ui.activePanel.value).toBe("calendar")

      ui.openDrawer("event-detail", "e1", "2026-05-01", "10:00")
      await nextTick()
      expect(ui.isDrawerOpen.value).toBe(true)
      expect(ui.drawer.value).toEqual({ type: "event-detail", id: "e1", date: "2026-05-01", time: "10:00" })

      // Close guard blocks closing
      ui.registerCloseGuard(() => false)
      ui.closeDrawer()
      expect(ui.isDrawerOpen.value).toBe(true)

      // Unregister guard → close succeeds and resets after 320ms
      ui.unregisterCloseGuard()
      ui.closeDrawer()
      expect(ui.isDrawerOpen.value).toBe(false)
      vi.advanceTimersByTime(350)
      expect(ui.drawer.value.type).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe("useSettings", () => {
  it("updates theme, accent (light & dark), fontSize, warm, and defaultReminderMinutes", () => {
    const s = useSettings()
    document.documentElement.classList.add("dark")
    s.updateTheme("dark")
    s.updateAccentColor("plum")
    s.updateFontSize("xlarge")
    s.updateWarm(true)
    s.updateDefaultReminderMinutes(15)

    expect(s.theme.value).toBe("dark")
    expect(s.accentColor.value).toBe("plum")
    expect(s.fontSize.value).toBe("xlarge")
    expect(s.warm.value).toBe(true)
    expect(s.defaultReminderMinutes.value).toBe(15)
    expect(document.documentElement.style.getPropertyValue("--text-display-size")).toBe("44px")
    document.documentElement.classList.remove("dark")
  })

  it("switches theme presets, keeps accents in-set, and toggles the futur class", () => {
    const s = useSettings()

    s.updateThemePreset("futur")
    expect(s.themePreset.value).toBe("futur")
    expect(s.accentColor.value).toBe("mint")
    expect(document.documentElement.classList.contains("futur")).toBe(true)

    s.updateAccentColor("clay")
    expect(s.accentColor.value).toBe("clay")

    s.updateThemePreset("default")
    expect(s.themePreset.value).toBe("default")
    expect(s.accentColor.value).toBe("sage")
    expect(document.documentElement.classList.contains("futur")).toBe(false)

    // Re-entering the preset remembers the accent last used there.
    s.updateThemePreset("futur")
    expect(s.accentColor.value).toBe("clay")
  })

  it("applies a full server payload and flags it so local sync does not echo it", async () => {
    const s = useSettings()
    expect(isApplyingRemoteSettings()).toBe(false)

    applyHouseholdSettings({
      theme: "dark",
      themePreset: "futur",
      accentColor: "honey",
      fontSize: "xlarge",
      warm: true,
      houseName: "Cedar",
      notifications: { hud: false, defaultReminderMinutes: 30 },
    })

    expect(s.theme.value).toBe("dark")
    expect(s.themePreset.value).toBe("futur")
    expect(s.accentColor.value).toBe("honey")
    expect(s.fontSize.value).toBe("xlarge")
    expect(s.warm.value).toBe(true)
    expect(s.houseName.value).toBe("Cedar")
    expect(s.hudEnabled.value).toBe(false)
    expect(s.defaultReminderMinutes.value).toBe(30)
    // The guard stays up through the watcher flush, then releases.
    expect(isApplyingRemoteSettings()).toBe(true)
    await nextTick()
    expect(isApplyingRemoteSettings()).toBe(false)
  })
})

describe("useNowIndicator", () => {
  it("tracks current minute on interval and computes isSameDay / nowFraction", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 4, 15, 14, 30, 45, 0))
    try {
      let api!: ReturnType<typeof useNowIndicator>
      const Comp = defineComponent({
        setup() {
          api = useNowIndicator()
          return () => h("div")
        },
      })
      const wrapper = mount(Comp)
      expect(api.isSameDay(new Date(2026, 4, 15, 8, 0))).toBe(true)
      expect(api.isSameDay(new Date(2026, 4, 16, 8, 0))).toBe(false)
      expect(api.nowFraction(new Date(2026, 4, 15), 14)).toBeCloseTo(0.5)
      expect(api.nowFraction(new Date(2026, 4, 15), 10)).toBeNull()
      expect(api.nowFraction(new Date(2026, 4, 16), 14)).toBeNull()

      // Advance past initial tick (15s) + one 60s interval
      vi.advanceTimersByTime(76_000)
      wrapper.unmount()
    } finally {
      vi.useRealTimers()
    }
  })
})

const _lsStore = new Map<string, string>()
const _memStorage: Storage = {
  get length() { return _lsStore.size },
  clear: () => _lsStore.clear(),
  getItem: (k: string) => _lsStore.get(k) ?? null,
  key: (i: number) => Array.from(_lsStore.keys())[i] ?? null,
  removeItem: (k: string) => { _lsStore.delete(k) },
  setItem: (k: string, v: string) => { _lsStore.set(k, String(v)) },
}
Object.defineProperty(window, "localStorage", { configurable: true, value: _memStorage })
Object.defineProperty(globalThis, "localStorage", { configurable: true, value: _memStorage })

describe("useWeather", () => {
  beforeEach(() => {
    localStorage.clear()
  })
  afterEach(() => {
    useWeather().stopAutoRefresh()
  })

  const openMeteoOk = {
    current: { temperature_2m: 21.4, apparent_temperature: 20.1, weather_code: 0, relative_humidity_2m: 55, wind_speed_10m: 12.3 },
    daily: { temperature_2m_max: [25.2], temperature_2m_min: [14.8], weather_code: [0] },
  }

  it("maps weatherLabel codes and refreshes with explicit lat/lon", async () => {
    const w = useWeather()
    expect(w.weatherLabel(0)).toBe("Clear")
    expect(w.weatherLabel(95)).toBe("Thunderstorm")
    expect(w.weatherLabel(9999)).toBe("Unknown")

    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify(openMeteoOk), { status: 200 }))
    await w.refresh({ lat: 43.65, lon: -79.38, address: "Toronto" })
    expect(w.weather.value?.temp).toBe(21)
    expect(w.weather.value?.location).toBe("Toronto")
  })

  it("geocodes address+province+country filtering mismatched country_code, and caches coords", async () => {
    const w = useWeather()
    vi.mocked(fetch)
      // 1st candidate returns US match (filtered out for CA), then CA match
      .mockResolvedValueOnce(new Response(JSON.stringify({
        results: [
          { latitude: 34.0, longitude: -117.6, name: "Ontario", country_code: "US" },
          { latitude: 43.7, longitude: -79.4, name: "Toronto", country_code: "CA" },
        ],
      }), { status: 200 }))
      // PATCH /household/settings
      .mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 200 }))
      // Forecast fetch
      .mockResolvedValueOnce(new Response(JSON.stringify(openMeteoOk), { status: 200 }))

    await w.refresh({ address: "123 Main St, Toronto", province: "Ontario", country: "ca" })
    expect(w.weather.value?.location).toBe("Toronto")
  })

  it("falls back to cached coords, geolocation, default NY, and handles retry / errors / autoRefresh", async () => {
    const w = useWeather()
    // Cached coords branch
    localStorage.setItem("homst:weather-coords", JSON.stringify({ lat: 51.5, lon: -0.1 }))
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify(openMeteoOk), { status: 200 }))
    await w.refresh({})
    expect(w.weather.value?.lat).toBe(51.5)

    // Corrupt cache + geolocation success + daily missing triggers NY retry then null
    localStorage.setItem("homst:weather-coords", "{bad-json")
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: {
        getCurrentPosition: (ok: (p: any) => void) => ok({ coords: { latitude: 10, longitude: 20 } }),
      },
    })
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(JSON.stringify({ current: {}, daily: {} }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ current: {}, daily: {} }), { status: 200 }))
    await w.refresh({})
    expect(w.weather.value).toBeNull()

    // Geolocation rejection → NY default; forecast HTTP error → sets error
    localStorage.clear()
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: { getCurrentPosition: (_ok: any, err: (e: any) => void) => err(new Error("denied")) },
    })
    vi.mocked(fetch).mockResolvedValue(new Response("err", { status: 500 }))
    await w.refresh({ address: "Nowhere", country: "invalid-code" })
    expect(w.error.value).toBe("Could not load weather")

    vi.useFakeTimers()
    try {
      vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify(openMeteoOk), { status: 200 }))
      w.startAutoRefresh({ lat: 1, lon: 2 })
      vi.advanceTimersByTime(30 * 60 * 1000)
      w.stopAutoRefresh()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe("useSpotify", () => {
  const origLocation = window.location

  beforeEach(() => {
    localStorage.clear()
    vi.resetModules()
    vi.stubEnv("VITE_SPOTIFY_CLIENT_ID", "")
    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        protocol: "http:",
        hostname: "localhost",
        port: "",
        origin: "http://localhost",
        pathname: "/",
        search: "",
        href: "http://localhost/",
      },
    })
    window.history.replaceState = vi.fn()
  })

  afterEach(() => {
    Object.defineProperty(window, "location", { configurable: true, value: origLocation })
  })

  it("handles config, PKCE connect (with subtle & pure-JS sha256 fallback), callback, polling, token refresh, and disconnect", async () => {
    vi.useFakeTimers()
    try {
      const mod = await import("@/composables/useSpotify")
      const sp = mod.useSpotify()

      expect(sp.formatTime(125_000)).toBe("2:05")
      expect(sp.needsConfig()).toBe(true)

      sp.setClientId("0123456789abcdef0123456789abcdef")
      expect(sp.needsConfig()).toBe(false)

      // Connect with pure-JS sha256 fallback (remove crypto.subtle temporarily)
      const origSubtle = crypto.subtle
      Object.defineProperty(crypto, "subtle", { configurable: true, value: undefined })
      try {
        await sp.connect()
      } finally {
        Object.defineProperty(crypto, "subtle", { configurable: true, value: origSubtle })
      }
      expect(localStorage.getItem("homst:spotify-code-verifier")).toBeTruthy()
      expect(window.location.href).toContain("https://accounts.spotify.com/authorize?")

      // Simulate OAuth callback in URL + expiring token refresh + polling responses
      window.location.search = "?code=auth-code-xyz"
      const trackPayload = {
        progress_ms: 1000,
        is_playing: true,
        item: {
          id: "tr1",
          name: "Song",
          artists: [{ name: "Artist A" }, { name: "Artist B" }],
          album: { images: [{ url: "https://img/1.jpg" }] },
          duration_ms: 10_000,
        },
      }
      vi.mocked(fetch)
        // handleCallback token exchange
        .mockResolvedValueOnce(new Response(JSON.stringify({
          access_token: "at-1", refresh_token: "rt-1", expires_in: 3600,
        }), { status: 200 }))
        // initial fetchCurrentlyPlaying → 200 with track
        .mockResolvedValueOnce(new Response(JSON.stringify(trackPayload), { status: 200 }))
        // next poll → 204 pauses
        .mockResolvedValueOnce(new Response(null, { status: 204 }))
        // next poll → 401 disconnects
        .mockResolvedValueOnce(new Response(null, { status: 401 }))

      await sp.init()
      await sp.init() // idempotent second call
      await vi.advanceTimersByTimeAsync(10)
      expect(sp.connected.value).toBe(true)
      expect(sp.currentTrack.value?.name).toBe("Song")

      // Elapsed timer advances progressMs
      vi.advanceTimersByTime(1000)
      expect(sp.currentTrack.value!.progressMs).toBeGreaterThanOrEqual(1000)

      // 5s poll → 204
      await vi.advanceTimersByTimeAsync(5000)
      expect(sp.currentTrack.value?.isPlaying).toBe(false)

      // 5s poll → 401
      await vi.advanceTimersByTimeAsync(5000)
      expect(sp.connected.value).toBe(false)

      // Expired token refresh path
      localStorage.setItem("homst:spotify-token", JSON.stringify({
        accessToken: "old", refreshToken: "rt-1", expiresAt: Date.now() + 1000,
      }))
      vi.mocked(fetch)
        .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "new-at", expires_in: 3600 }), { status: 200 }))
        .mockRejectedValueOnce(new Error("network down"))
      await vi.advanceTimersByTimeAsync(5000)
      expect(sp.error.value).toBe("Could not reach Spotify")

      sp.disconnect()
      expect(sp.connected.value).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it("handles failed callback exchange", async () => {
    localStorage.setItem("homst:spotify-client-id", "cid")
    localStorage.setItem("homst:spotify-code-verifier", "ver")
    window.location.search = "?code=bad"
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 }))
    const { useSpotify } = await import("@/composables/useSpotify")
    const sp = useSpotify()
    await sp.init()
    expect(sp.error.value).toContain("Authorization failed")
  })
})
