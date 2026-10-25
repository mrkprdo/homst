import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { nextTick } from "vue"
import { mount, flushPromises } from "@vue/test-utils"

/* ── in-memory localStorage ──────────────────────────────────────────────────── */
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

const LAYOUT_KEY = "homst-widget-layout"
const CLIENT_ID_KEY = "homst:spotify-client-id"

/* ── window.location can be replaced in jsdom; used to pin the redirect-URI
      branch (http + no port) and to swallow Spotify redirects ───────────────── */
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
function restoreLocation() {
  Object.defineProperty(window, "location", { configurable: true, writable: true, value: REAL_LOCATION })
}

interface Opts {
  body?: unknown
  fail?: boolean
  seed?: (c: Record<string, any>) => void
}

function mockApi({ body = {}, fail = false }: Opts = {}) {
  vi.mocked(fetch).mockImplementation(((input: any) => {
    const url = String(input)
    if (url.includes("/household/settings")) {
      if (fail) return Promise.reject(new Error("settings unavailable"))
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }))
    }
    return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }))
  }) as any)
}

/**
 * Import a brand-new copy of HomeView (so its module-scope `readCachedLayout()`
 * runs against the current localStorage) together with the fresh composable
 * instances it consumes.
 */
async function freshMount(opts: Opts = {}) {
  mockApi(opts)
  vi.resetModules()
  const { default: FreshHomeView } = await import("@/components/home/HomeView.vue")
  const motion = await import("@/lib/motion")
  motion.setLowPower(true)

  const composables = {
    ui: (await import("@/composables/useUi")).useUi(),
    spotify: (await import("@/composables/useSpotify")).useSpotify(),
    weather: (await import("@/composables/useWeather")).useWeather(),
    events: (await import("@/composables/useEvents")).useEvents(),
    tasks: (await import("@/composables/useTasks")).useTasks(),
    members: (await import("@/composables/useMembers")).useMembers(),
    settings: (await import("@/composables/useSettings")).useSettings(),
  }
  opts.seed?.(composables)

  const wrapper = mount(FreshHomeView)
  await flushPromises()
  await nextTick()
  return { wrapper, motion, ...composables }
}

/** The five widgets `applyLayout` refuses to drop. */
const required = (overrides: Record<string, any>[] = []) => [
  { id: "datetime", col: 0, row: 0, w: 1, h: 1 },
  { id: "schedule", col: 1, row: 0, w: 1, h: 1 },
  { id: "weather", col: 2, row: 0, w: 1, h: 1 },
  { id: "calendar", col: 3, row: 0, w: 1, h: 1 },
  { id: "todos", col: 0, row: 1, w: 1, h: 1 },
  ...overrides,
]

beforeEach(() => {
  localStorage.clear()
  vi.stubEnv("VITE_SPOTIFY_CLIENT_ID", "")
})

afterEach(() => {
  restoreLocation()
  vi.unstubAllEnvs()
})

describe("HomeView — layout engine & edit mode", () => {
  it("wires every edit handle and applies move/resize into free cells", async () => {
    const { wrapper, ui } = await freshMount({
      body: {
        houseName: "Full Home",
        widgetLayout: [
          { id: "calendar", col: 0, row: 0, w: 2, h: 2 },
          { id: "datetime", col: 2, row: 0, w: 2, h: 1 },
          { id: "weather",  col: 4, row: 0, w: 2, h: 1 },
          { id: "schedule", col: 2, row: 1, w: 2, h: 1 },
          { id: "todos",    col: 0, row: 4, w: 1, h: 1 },
          { id: "photos",   col: 4, row: 2, w: 2, h: 2 },
          { id: "spotify",  col: 3, row: 2, w: 1, h: 1 },
        ],
      },
    })
    expect(wrapper.text()).toContain("Full Home")

    // Stray pointer events outside a drag are ignored
    window.dispatchEvent(new MouseEvent("pointermove", { clientX: 1, clientY: 1 }))
    window.dispatchEvent(new MouseEvent("pointerup"))

    await wrapper.find(".lock-toggle").trigger("click")
    const dragHandles = wrapper.findAll(".drag-handle")
    const resizeHandles = wrapper.findAll(".resize-handle")
    expect(dragHandles.length).toBe(7)
    expect(resizeHandles.length).toBe(7)

    // Both handle for every widget
    for (const handle of [...dragHandles, ...resizeHandles]) {
      handle.element.dispatchEvent(new MouseEvent("pointerdown", { clientX: 5, clientY: 5, bubbles: true }))
      window.dispatchEvent(new MouseEvent("pointerup"))
    }

    // Move "todos" (handle 4) three columns right into a free row-5 cell
    expect(wrapper.findAll(".widget")[4].attributes("style")).toContain("grid-row: 5 / span 1")
    dragHandles[4].element.dispatchEvent(new MouseEvent("pointerdown", { clientX: 10, clientY: 10, bubbles: true }))
    window.dispatchEvent(new MouseEvent("pointermove", { clientX: 610, clientY: 10 }))
    window.dispatchEvent(new MouseEvent("pointerup"))
    await nextTick()
    expect(wrapper.findAll(".widget")[4].attributes("style")).toContain("grid-column: 4 / span 1")

    // Resize "spotify" (handle 6) one row taller into the free row below
    expect(wrapper.findAll(".widget")[6].attributes("style")).toContain("grid-row: 3 / span 1")
    resizeHandles[6].element.dispatchEvent(new MouseEvent("pointerdown", { clientX: 10, clientY: 10, bubbles: true }))
    window.dispatchEvent(new MouseEvent("pointermove", { clientX: 10, clientY: 210 }))
    window.dispatchEvent(new MouseEvent("pointerup"))
    await nextTick()
    expect(wrapper.findAll(".widget")[6].attributes("style")).toContain("grid-row: 3 / span 2")

    // Header shortcut links
    await wrapper.findAll(".widget")[1].find("button").trigger("click")
    expect(ui.activePanel.value).toBe("calendar")
    ui.setPanel("home")
    await wrapper.findAll(".widget")[3].find("button").trigger("click")
    expect(ui.activePanel.value).toBe("calendar")
    ui.setPanel("home")
    await wrapper.findAll(".widget")[4].find("button").trigger("click")
    expect(ui.activePanel.value).toBe("tasks")

    wrapper.unmount()
  })

  it("lets any widget shrink to a single grid cell", async () => {
    const { wrapper } = await freshMount({ body: { houseName: "Minimums" } })
    await wrapper.find(".lock-toggle").trigger("click")

    // Date & Time ships 1×2; drag both axes in until the card is 1×1.
    expect(wrapper.findAll(".widget")[0].attributes("style")).toContain("grid-column: 4 / span 1")
    const handle = wrapper.findAll(".resize-handle")[0]
    handle.element.dispatchEvent(new MouseEvent("pointerdown", { clientX: 10, clientY: 10, bubbles: true }))
    window.dispatchEvent(new MouseEvent("pointermove", { clientX: -390, clientY: -210 }))
    window.dispatchEvent(new MouseEvent("pointerup"))
    await nextTick()

    expect(wrapper.findAll(".widget")[0].attributes("style")).toContain("grid-column: 4 / span 1")
    expect(wrapper.findAll(".widget")[0].attributes("style")).toContain("grid-row: 1 / span 1")
    wrapper.unmount()
  })

  it("ignores a layout whose coordinates are not numeric", async () => {
    const { wrapper } = await freshMount({
      body: {
        widgetLayout: [
          { id: "datetime", col: "0", row: 0, w: 1, h: 1 },
          ...required().slice(1),
        ],
      },
    })
    // Rejected → the default layout survives (Date & Time is one column wide)
    expect(wrapper.findAll(".widget").length).toBe(7)
    expect(wrapper.findAll(".widget")[0].attributes("style")).toContain("grid-column: 4 / span 1")
    wrapper.unmount()
  })

  it("falls back to the default geometry when the grid has no free slot", async () => {
    const { wrapper } = await freshMount({
      body: {
        widgetLayout: [
          { id: "datetime", col: 0, row: 0, w: 6, h: 2 },
          { id: "schedule", col: 0, row: 2, w: 6, h: 1 },
          { id: "weather", col: 0, row: 3, w: 6, h: 1 },
          { id: "calendar", col: 0, row: 4, w: 6, h: 1 },
          { id: "todos", col: 0, row: 5, w: 6, h: 1 },
        ],
      },
    })
    // spotify & photos were appended with their *default* coords (no slot found)
    expect(wrapper.findAll(".widget").length).toBe(7)
    expect(wrapper.findAll(".widget")[5].attributes("style")).toContain("grid-column: 3 / span 4")
    expect(wrapper.findAll(".widget")[6].attributes("style")).toContain("grid-column: 5 / span 1")
    wrapper.unmount()
  })

  it("falls back to a generic house name when settings fail to load", async () => {
    const { wrapper } = await freshMount({ fail: true })
    expect(wrapper.find(".datetime-house").text()).toBe("Home")
    wrapper.unmount()
  })

  it("renders a legacy all-day event with its assignee", async () => {
    const { wrapper } = await freshMount({
      body: { houseName: "Schedule Home" },
      seed: ({ events, members }) => {
        members.upsertMember({
          id: "m1", householdId: "h", name: "Alice", avatarUrl: null,
          color: "#b1b695", role: "admin", joinedAt: "",
        })
        const iso = new Date().toISOString()
        events.upsertEvent({
          id: "e1", calendarId: "c1", title: "Legacy Holiday", description: "",
          startAt: iso, endAt: iso, allDay: true, recurrence: null,
          assigneeId: "m1", source: "internal", externalUid: null, createdBy: null,
          createdAt: "", updatedAt: "",
        })
      },
    })
    await nextTick()
    expect(wrapper.find(".schedule-title").text()).toBe("Legacy Holiday")
    expect(wrapper.find(".schedule-assignee").text()).toBe("Alice")
    wrapper.unmount()
  })

  it("rolls the wall clock over and surfaces a weather error", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] })
    const base = Math.floor(Date.now() / 60_000) * 60_000 - 1_000
    vi.setSystemTime(base)
    try {
      const { wrapper, weather } = await freshMount({ body: { houseName: "Tick Tock" } })
      expect(wrapper.find(".datetime-date").text()).toBeTruthy()

      await vi.advanceTimersByTimeAsync(1_000)
      await nextTick()
      expect(wrapper.find(".datetime-date").text()).toBe(
        new Date(base + 1_000).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }),
      )

      weather.loading.value = false
      weather.error.value = "Weather service unavailable"
      await nextTick()
      expect(wrapper.find(".weather-error").text()).toBe("Weather service unavailable")
      wrapper.unmount()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe("HomeView — cached layout (import time)", () => {
  const CACHED = [
    { id: "datetime", col: 0, row: 0, w: 2, h: 1 },
    { id: "weather", col: 2, row: 0, w: 2, h: 1 },
    { id: "schedule", col: 0, row: 1, w: 1, h: 1 },
    { id: "todos", col: 1, row: 1, w: 1, h: 1 },
    { id: "spotify", col: 2, row: 1, w: 2, h: 2 },
    { id: "calendar", col: 0, row: 3, w: 4, h: 1 },
    { id: "photos", col: 0, row: 4, w: 4, h: 1 },
  ]

  it("hydrates a cached layout, observes the canvas and runs the entrance animation", async () => {
    localStorage.setItem(LAYOUT_KEY, JSON.stringify(CACHED))
    let roCb: ((entries: any[]) => void) | null = null
    let observed: Element | null = null
    const OriginalRO = globalThis.ResizeObserver
    globalThis.ResizeObserver = class {
      constructor(cb: (entries: any[]) => void) { roCb = cb }
      observe(el: Element) { observed = el }
      unobserve() {}
      disconnect() {}
    } as any
    try {
      const { wrapper } = await freshMount({ body: { houseName: "Cached Home" } })
      // layoutReady starts true → canvas is in the DOM right after mount
      expect(wrapper.find(".widget-canvas").exists()).toBe(true)
      expect(wrapper.findAll(".widget").length).toBe(7)
      const canvas = wrapper.find(".widget-canvas").element
      expect(observed).toBe(canvas)

      // canvas measurements feed the grid units used by drag math
      roCb!([{ contentRect: { width: 1_200, height: 700 } }])
      await nextTick()

      await wrapper.find(".lock-toggle").trigger("click")
      const handle = wrapper.findAll(".drag-handle")[0]
      handle.element.dispatchEvent(new MouseEvent("pointerdown", { clientX: 10, clientY: 10, bubbles: true }))
      // rowUnit = (700 + 12) / 6 ≈ 118.7 → 285px is two rows down
      window.dispatchEvent(new MouseEvent("pointermove", { clientX: 10, clientY: 295 }))
      window.dispatchEvent(new MouseEvent("pointerup"))
      await nextTick()
      expect(wrapper.findAll(".widget")[0].attributes("style")).toContain("grid-row: 3 / span 1")
      wrapper.unmount()
    } finally {
      globalThis.ResizeObserver = OriginalRO
    }
  })

  it("rejects malformed cached layouts", async () => {
    const malformed = [
      "{}",
      JSON.stringify([{ id: 1 }]),
      JSON.stringify([{ id: "datetime", col: "x", row: 0, w: 1, h: 1 }]),
      "{ not json",
    ]
    for (const raw of malformed) {
      localStorage.setItem(LAYOUT_KEY, raw)
      const { wrapper } = await freshMount({ body: {} })
      expect(wrapper.findAll(".widget").length).toBe(7)
      wrapper.unmount()
    }
  })

  it("migrates the legacy overlapping layout back to the default", async () => {
    localStorage.setItem(LAYOUT_KEY, JSON.stringify([
      { id: "datetime", col: 0, row: 0, w: 2, h: 1 },
      { id: "weather", col: 2, row: 0, w: 2, h: 1 },
      { id: "schedule", col: 0, row: 1, w: 1, h: 1 },
      { id: "todos", col: 1, row: 1, w: 1, h: 1 },
      { id: "spotify", col: 2, row: 1, w: 2, h: 2 },
      { id: "calendar", col: 0, row: 2, w: 4, h: 2 },
      { id: "photos", col: 0, row: 4, w: 4, h: 1 },
    ]))
    const { wrapper } = await freshMount({ body: {} })
    expect(wrapper.findAll(".widget")[0]!.attributes("style")).toContain("grid-column: 4 / span 1")
    wrapper.unmount()
  })
})

describe("HomeView — widget data edge cases", () => {
  const COMPLETE_LAYOUT = [
    { id: "datetime", col: 0, row: 0, w: 2, h: 1 },
    { id: "schedule", col: 0, row: 1, w: 2, h: 1 },
    { id: "weather", col: 2, row: 0, w: 2, h: 2 },
    { id: "calendar", col: 2, row: 2, w: 2, h: 1 },
    { id: "todos", col: 0, row: 2, w: 2, h: 1 },
    { id: "photos", col: 0, row: 3, w: 2, h: 1 },
    { id: "spotify", col: 0, row: 4, w: 2, h: 1 },
  ]

  it("accepts a complete server layout without saving it back", async () => {
    const { wrapper } = await freshMount({ body: { houseName: "Complete", widgetLayout: COMPLETE_LAYOUT } })
    expect(wrapper.findAll(".widget").length).toBe(7)
    // schedule sits where the server put it → applyLayout kept the response as-is
    expect(wrapper.findAll(".widget")[1].attributes("style")).toContain("grid-column: 1 / span 2")
    expect(wrapper.findAll(".widget")[2].attributes("style")).toContain("grid-column: 3 / span 2")

    const patches = vi.mocked(fetch).mock.calls.filter(c => (c[1] as any)?.method === "PATCH")
    expect(patches.length).toBe(0)
    wrapper.unmount()
  })

  it("survives a missing photo list", async () => {
    const { wrapper, settings } = await freshMount({ body: { houseName: "No Photos" } })
    ;(settings.photos as any).value = null
    await nextTick()
    expect(wrapper.text()).toContain("No photos selected")
    wrapper.unmount()
  })

  it("lists todos with and without due dates and hides 'Up next' when idle", async () => {
    const { wrapper } = await freshMount({
      body: { houseName: "Todos" },
      seed: ({ tasks }) => {
        const base = {
          listId: "l1", description: "", assigneeId: null, endAt: null,
          status: "todo" as const, priority: "medium" as const,
          createdBy: null, createdAt: "", updatedAt: "",
        }
        tasks.upsertTask({ ...base, id: "t1", title: "No due date", startAt: null, position: 0 })
        tasks.upsertTask({ ...base, id: "t2", title: "Due soon", startAt: new Date(Date.now() + 86_400_000).toISOString(), position: 1 })
      },
    })
    await nextTick()

    expect(wrapper.findAll(".task-row").length).toBe(2)
    expect(wrapper.findAll(".task-due").length).toBe(1)
    expect(wrapper.text()).not.toContain("Up next")
    wrapper.unmount()
  })

  it("groups in-progress and upcoming tasks when the todo tile is tall enough", async () => {
    const { wrapper } = await freshMount({
      body: {
        houseName: "Grouped",
        widgetLayout: [
          { id: "datetime", col: 0, row: 0, w: 2, h: 1 },
          { id: "schedule", col: 2, row: 0, w: 2, h: 1 },
          { id: "weather",  col: 0, row: 1, w: 2, h: 1 },
          { id: "calendar", col: 2, row: 1, w: 2, h: 2 },
          { id: "todos",    col: 0, row: 2, w: 2, h: 2 },
          { id: "photos",   col: 0, row: 4, w: 2, h: 1 },
          { id: "spotify",  col: 2, row: 4, w: 2, h: 1 },
        ],
      },
      seed: ({ tasks }) => {
        const base = {
          listId: "l1", description: "", assigneeId: null, startAt: null,
          endAt: null, priority: "medium" as const,
          createdBy: null, createdAt: "", updatedAt: "",
        }
        tasks.upsertTask({ ...base, id: "t1", title: "Doing now", status: "doing", position: 0 })
        tasks.upsertTask({ ...base, id: "t2", title: "Later", status: "todo", position: 0 })
      },
    })
    await nextTick()

    expect(wrapper.findAll(".task-group-label").map(label => label.text())).toEqual(["In progress", "Up next"])
    expect(wrapper.findAll(".task-row").length).toBe(2)
    wrapper.unmount()
  })

  it("tolerates a playing track with an unknown duration", async () => {
    vi.stubEnv("VITE_SPOTIFY_CLIENT_ID", "configured-client")
    const { wrapper, spotify } = await freshMount({ body: { houseName: "Music" } })
    spotify.connected.value = true
    spotify.currentTrack.value = {
      id: "tr", name: "Song", artists: "A", albumArt: "", progressMs: 1_000, durationMs: 0, isPlaying: true,
    }
    await nextTick()
    expect(wrapper.find(".spotify-time").text()).toBe("0:01")
    expect(wrapper.find(".spotify-time--end").text()).toBe("0:00")
    expect(wrapper.find(".spotify-bar-fill").attributes("style")).toContain("scaleX(0)")
    wrapper.unmount()
  })

  it("keeps the card record still when spinning album art is off", async () => {
    vi.stubEnv("VITE_SPOTIFY_CLIENT_ID", "configured-client")
    const { wrapper, spotify } = await freshMount({
      body: { houseName: "Music" },
      seed: (c) => c.settings.updateMusicCardSpin(false),
    })
    spotify.connected.value = true
    spotify.currentTrack.value = {
      id: "tr", name: "Song", artists: "A", albumArt: "", progressMs: 1_000, durationMs: 200_000, isPlaying: true,
    }
    await nextTick()
    expect(wrapper.find(".spotify-vinyl").classes()).toContain("spotify-vinyl--still")
    wrapper.unmount()
  })

  it("ignores a failed layout save", async () => {
    const { wrapper } = await freshMount({
      body: { houseName: "Save Fail", widgetLayout: required() },
    })
    vi.mocked(fetch).mockImplementation(((input: any, init: any) => {
      if (init?.method === "PATCH") return Promise.reject(new Error("offline"))
      return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }))
    }) as any)

    await wrapper.find(".lock-toggle").trigger("click")
    const handle = wrapper.findAll(".drag-handle")[4]!
    handle.element.dispatchEvent(new MouseEvent("pointerdown", { clientX: 10, clientY: 10, bubbles: true }))
    window.dispatchEvent(new MouseEvent("pointermove", { clientX: 10, clientY: 410 }))
    window.dispatchEvent(new MouseEvent("pointerup"))
    await flushPromises()

    // the move still lands locally even though the save was rejected
    expect(wrapper.findAll(".widget")[4].attributes("style")).toContain("grid-row: 4 / span 1")
    wrapper.unmount()
  })
})

describe("HomeView — Spotify widget", () => {
  it("connects from the setup form using a pasted client id", async () => {
    stubLocation()
    const { wrapper } = await freshMount({ body: {} })

    expect(wrapper.find(".spotify-setup").exists()).toBe(true)
    // Redirect URI branch: http + no port → pinned :80
    expect(wrapper.find(".spotify-setup-steps").text()).toContain("http://homst:80")

    // Empty input is ignored
    await wrapper.find(".spotify-connect-btn").trigger("click")
    expect(localStorage.getItem(CLIENT_ID_KEY)).toBeNull()

    // Enter in the input submits
    await wrapper.find(".spotify-setup-input").setValue("0123456789abcdef0123456789abcdef")
    await wrapper.find(".spotify-setup-input").trigger("keyup", { key: "Enter" })
    expect(localStorage.getItem(CLIENT_ID_KEY)).toBe("0123456789abcdef0123456789abcdef")
    // the PKCE flow starts (verifier stored synchronously before the redirect)
    expect(localStorage.getItem("homst:spotify-code-verifier")).toBeTruthy()
    wrapper.unmount()
  })

  it("rejects a malformed Spotify client id", async () => {
    stubLocation()
    const { wrapper } = await freshMount({ body: {} })
    await wrapper.find(".spotify-setup-input").setValue("not-a-client-id")
    await wrapper.find(".spotify-connect-btn").trigger("click")
    expect(wrapper.find(".spotify-error").text()).toContain("32 letters/digits")
    expect(localStorage.getItem(CLIENT_ID_KEY)).toBeNull()
    wrapper.unmount()
  })

  it("disconnects and connects from the idle state", async () => {
    vi.stubEnv("VITE_SPOTIFY_CLIENT_ID", "0123456789abcdef0123456789abcdef")
    stubLocation()
    const { wrapper, spotify } = await freshMount({ body: {} })

    expect(wrapper.find(".spotify-setup").exists()).toBe(false)

    spotify.connected.value = true
    spotify.currentTrack.value = null
    await nextTick()
    expect(wrapper.text()).toContain("Nothing playing")
    await wrapper.find(".spotify-connect-btn--small").trigger("click")
    expect(spotify.connected.value).toBe(false)

    await nextTick()
    const connectBtn = wrapper.find("button.spotify-connect-btn")
    expect(connectBtn.text()).toBe("Connect Spotify")
    await connectBtn.trigger("click")
    await nextTick()
    expect(localStorage.getItem("homst:spotify-code-verifier")).toBeTruthy()
    wrapper.unmount()
  })
})
