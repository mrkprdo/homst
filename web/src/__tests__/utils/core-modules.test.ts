import { describe, it, expect, vi, beforeEach } from "vitest"
import { REMINDER_OPTIONS, reminderLabel, reminderMinutesFromValue } from "@/utils/reminders"
import { uid } from "@/utils/uid"
import { photosApi } from "@/api/photos"
import { holidaysApi } from "@/api/holidays"
import { api } from "@/api/client"
import router, { invalidateSettings } from "@/router"
import { HOUSEHOLD_COMPLETE_KEY } from "@/lib/householdCache"
import {
  setLowPower,
  getAnimationEnabled,
  setAnimationEnabled,
  springs,
  ease,
  dur,
  animate,
} from "@/lib/motion"

describe("utils/reminders", () => {
  it("exports REMINDER_OPTIONS", () => {
    expect(REMINDER_OPTIONS.length).toBeGreaterThan(0)
    expect(REMINDER_OPTIONS[0]).toEqual({ value: "", label: "No reminder" })
  })

  it("reminderLabel handles null, undefined, known options, custom minutes, and multi-day offsets", () => {
    expect(reminderLabel(null)).toBeNull()
    expect(reminderLabel(undefined)).toBeNull()
    expect(reminderLabel(0)).toBe("At start time")
    expect(reminderLabel(15)).toBe("15 minutes before")
    expect(reminderLabel(1440)).toBe("1 day before")
    expect(reminderLabel(2880)).toBe("2 days before")
  })

  it("reminderMinutesFromValue parses empty string to null and numbers", () => {
    expect(reminderMinutesFromValue("")).toBeNull()
    expect(reminderMinutesFromValue("0")).toBe(0)
    expect(reminderMinutesFromValue("30")).toBe(30)
  })
})

describe("utils/uid", () => {
  it("uses crypto.randomUUID when available", () => {
    const id = uid()
    expect(id).toMatch(/^[0-9a-f-]{36}$/)
  })

  it("falls back to math-based UUID v4 when crypto.randomUUID is unavailable", () => {
    const orig = crypto.randomUUID
    // @ts-expect-error testing fallback
    crypto.randomUUID = undefined
    try {
      const id = uid()
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    } finally {
      crypto.randomUUID = orig
    }
  })
})

describe("api/photos, api/holidays, api/client upload", () => {
  it("photosApi list, upload, update, remove", async () => {
    await photosApi.list()
    expect(fetch).toHaveBeenCalledWith("/api/v1/photos", expect.any(Object))

    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ id: "p1", url: "/u", selected: true, created_at: "" }), { status: 200 }),
    )
    const file = new File(["bytes"], "pic.jpg", { type: "image/jpeg" })
    const uploaded = await photosApi.upload(file)
    expect(uploaded.id).toBe("p1")

    await photosApi.update("p1", { selected: false })
    expect(fetch).toHaveBeenCalledWith(
      "/api/v1/photos/p1",
      expect.objectContaining({ method: "PATCH", body: JSON.stringify({ selected: false }) }),
    )

    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 204 }))
    await photosApi.remove("p1")
    expect(fetch).toHaveBeenCalledWith("/api/v1/photos/p1", expect.objectContaining({ method: "DELETE" }))
  })

  it("api.upload throws with server detail or fallback status message on failure", async () => {
    const form = new FormData()
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ detail: "Too large" }), { status: 413 }),
    )
    await expect(api.upload("/photos", form)).rejects.toThrow("Too large")

    vi.mocked(fetch).mockResolvedValueOnce(new Response("not-json", { status: 500 }))
    await expect(api.upload("/photos", form)).rejects.toThrow("Upload failed: 500")
  })

  it("holidaysApi sync (with and without province) and list", async () => {
    await holidaysApi.sync("CA", "ON")
    expect(fetch).toHaveBeenCalledWith(
      "/api/v1/holidays/sync",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ country_code: "CA", province: "ON" }),
      }),
    )

    await holidaysApi.sync("US")
    expect(fetch).toHaveBeenCalledWith(
      "/api/v1/holidays/sync",
      expect.objectContaining({
        body: JSON.stringify({ country_code: "US", province: null }),
      }),
    )

    await holidaysApi.list()
    expect(fetch).toHaveBeenCalledWith("/api/v1/holidays", expect.any(Object))
  })
})

function installMemoryStorage() {
  const store = new Map<string, string>()
  const mem: Storage = {
    get length() { return store.size },
    clear: () => store.clear(),
    getItem: (k: string) => store.get(k) ?? null,
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    removeItem: (k: string) => { store.delete(k) },
    setItem: (k: string, v: string) => { store.set(k, String(v)) },
  }
  Object.defineProperty(window, "localStorage", { configurable: true, value: mem })
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: mem })
}
installMemoryStorage()

describe("router lazy routes", () => {
  it("imports the onboarding view only when its route is used", async () => {
    const route = router.getRoutes().find((item) => item.name === "onboarding")!
    const loader = route.components!.default as () => Promise<{ default: unknown }>
    const module = await loader()
    expect(module.default).toBeTruthy()
  })
})

describe("router", () => {
  beforeEach(() => {
    invalidateSettings()
    // Replace lazy route components with lightweight stubs so route transitions don't load full views
    for (const r of router.getRoutes()) {
      if (r.components) {
        r.components.default = { template: "<div />" } as any
      }
    }
  })

  it("redirects / to /onboarding when household is not complete, and handles fetch failure", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error("offline"))
    await router.push("/?attempt=1")
    expect(router.currentRoute.value.path).toBe("/onboarding")

    invalidateSettings()
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ isComplete: false }), { status: 200 }),
    )
    await router.push("/?attempt=2")
    expect(router.currentRoute.value.path).toBe("/onboarding")
  })

  it("keeps the cached household when the server is unreachable off-LAN", async () => {
    localStorage.setItem(HOUSEHOLD_COMPLETE_KEY, "true")
    invalidateSettings()
    vi.mocked(fetch).mockRejectedValueOnce(new TypeError("Failed to fetch"))

    await router.push("/?offline=1")
    expect(router.currentRoute.value.path).toBe("/")
  })

  it("redirects /onboarding to / when complete via API or the cached flag", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ isComplete: true }), { status: 200 }),
    )
    await router.push("/onboarding?attempt=1")
    expect(router.currentRoute.value.path).toBe("/")

    // Cached branch (fetched === true)
    await router.push("/onboarding?attempt=2")
    expect(router.currentRoute.value.path).toBe("/")

    localStorage.setItem(HOUSEHOLD_COMPLETE_KEY, "true")
    invalidateSettings()
    await router.push("/onboarding?attempt=3")
    expect(router.currentRoute.value.path).toBe("/")
  })
})

describe("lib/motion", () => {
  beforeEach(() => {
    setLowPower(false)
    localStorage.clear()
  })

  it("exports springs, ease, dur and toggles low-power / animation preference", () => {
    expect(springs.enter).toBeDefined()
    expect(ease.out).toBe("outQuart")
    expect(dur.base).toBe(200)

    expect(getAnimationEnabled()).toBe(true)
    setAnimationEnabled(false)
    expect(getAnimationEnabled()).toBe(false)
    expect(localStorage.getItem("homst-animations-enabled")).toBe("false")
    expect(document.documentElement.classList.contains("low-power")).toBe(true)

    setAnimationEnabled(true)
    expect(getAnimationEnabled()).toBe(true)
  })

  it("animate() in low-power mode applies final state across target types and runs onComplete", async () => {
    setLowPower(true)
    const el1 = document.createElement("div")
    el1.className = "m-target"
    const el2 = document.createElement("div")
    document.body.appendChild(el1)

    let completed = false
    const stub = animate([el1, el2], {
      opacity: [0, 1],
      translateX: [10, 20],
      translateY: "-5px",
      rotate: 45,
      scale: 2,
      duration: 100,
      undefProp: undefined,
      onComplete: () => {
        completed = true
      },
    } as any)

    expect(el1.style.opacity).toBe("1")
    expect(el1.style.transform).toContain("translateX(20px)")
    expect(el1.style.transform).toContain("translateY(-5px)")
    expect(el1.style.transform).toContain("rotate(45deg)")
    expect(el1.style.transform).toContain("scale(2)")

    // Selector & NodeList & single Element & null targets
    animate(".m-target", { opacity: 0.5 } as any)
    expect(el1.style.opacity).toBe("0.5")
    animate(document.querySelectorAll(".m-target"), { opacity: 0.8 } as any)
    expect(el1.style.opacity).toBe("0.8")
    animate(el1, { opacity: 0.9 } as any)
    expect(el1.style.opacity).toBe("0.9")
    animate(null as any, { opacity: 0 } as any)
    animate(123 as any, { opacity: 0 } as any)

    // Stub chainable methods
    expect(stub.complete()).toBe(stub)
    expect(stub.cancel()).toBe(stub)
    expect(stub.revert()).toBe(stub)
    expect(stub.pause()).toBe(stub)
    expect(stub.play()).toBe(stub)
    expect(stub.seek(0)).toBe(stub)

    await new Promise(r => setTimeout(r, 30))
    expect(completed).toBe(true)

    // setTimeout fallback when requestAnimationFrame is unavailable
    const origRAF = globalThis.requestAnimationFrame
    // @ts-expect-error testing fallback
    globalThis.requestAnimationFrame = undefined
    try {
      let cb2 = false
      animate(el1, { opacity: 1, onComplete: () => { cb2 = true } } as any)
      await new Promise(r => setTimeout(r, 20))
      expect(cb2).toBe(true)
    } finally {
      globalThis.requestAnimationFrame = origRAF
      el1.remove()
    }
  })
})
