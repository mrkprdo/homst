import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

/* ── in-memory localStorage (Node's own global shadows jsdom's) ─────────────── */
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

const ANIMATIONS_ENABLED_KEY = "homst-animations-enabled"
const REAL_LOCATION = window.location
const REAL_MATCH_MEDIA = window.matchMedia
const REAL_UA = window.navigator.userAgent
const REAL_CORES = window.navigator.hardwareConcurrency

function setMatchMedia(matches: boolean) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: vi.fn((query: string) => ({
      matches,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  })
}

function stubLocation(search: string) {
  Object.defineProperty(window, "location", {
    configurable: true,
    writable: true,
    value: {
      protocol: "http:", hostname: "localhost", port: "3000", origin: "http://localhost:3000",
      href: "http://localhost:3000/", search, pathname: "/", hash: "",
    },
  })
}

function setNavigator(ua: string, cores?: number, deviceMemory?: number) {
  Object.defineProperty(window.navigator, "userAgent", { configurable: true, value: ua })
  if (cores === undefined) {
    delete (window.navigator as any).hardwareConcurrency
  } else {
    Object.defineProperty(window.navigator, "hardwareConcurrency", { configurable: true, value: cores })
  }
  if (deviceMemory !== undefined) {
    Object.defineProperty(window.navigator, "deviceMemory", { configurable: true, value: deviceMemory })
  }
}

/** Re-evaluate the module-level low-power detection. */
async function freshMotion() {
  vi.resetModules()
  return await import("@/lib/motion")
}

beforeEach(() => {
  localStorage.clear()
  document.documentElement.classList.remove("low-power")
  setMatchMedia(false)
  stubLocation("")
  setNavigator(REAL_UA, 8)
})

afterEach(() => {
  Object.defineProperty(window, "location", { configurable: true, writable: true, value: REAL_LOCATION })
  Object.defineProperty(window, "matchMedia", { configurable: true, writable: true, value: REAL_MATCH_MEDIA })
  setNavigator(REAL_UA, REAL_CORES)
  delete (window.navigator as any).deviceMemory
  document.documentElement.classList.remove("low-power")
})

describe("lib/motion — low-power detection at import time", () => {
  it("honours prefers-reduced-motion and tags the document", async () => {
    setMatchMedia(true)
    const motion = await freshMotion()
    expect(motion.isLowPower).toBe(true)
    expect(document.documentElement.classList.contains("low-power")).toBe(true)
  })

  it("lets a stored override disable animations", async () => {
    localStorage.setItem(ANIMATIONS_ENABLED_KEY, "false")
    const off = await freshMotion()
    expect(off.isLowPower).toBe(true)

    localStorage.setItem(ANIMATIONS_ENABLED_KEY, "true")
    document.documentElement.classList.remove("low-power")
    const on = await freshMotion()
    expect(on.isLowPower).toBe(false)
    expect(document.documentElement.classList.contains("low-power")).toBe(false)
  })

  it("supports the ?low-power debug flag", async () => {
    stubLocation("?low-power=1")
    const motion = await freshMotion()
    expect(motion.isLowPower).toBe(true)
  })

  it("detects low-end ARM display boards", async () => {
    setNavigator("Mozilla/5.0 (X11; Linux aarch64)", 4)
    const cores = await freshMotion()
    expect(cores.isLowPower).toBe(true)

    localStorage.clear()
    setNavigator("Mozilla/5.0 (X11; Linux armv7l)", 8, 2)
    const memory = await freshMotion()
    expect(memory.isLowPower).toBe(true)

    localStorage.clear()
    setNavigator("Mozilla/5.0 (Windows NT 10.0; Win64; x64)", 4)
    const desktop = await freshMotion()
    expect(desktop.isLowPower).toBe(false)
  })

  it("exposes the animation preference toggle", async () => {
    const motion = await freshMotion()
    motion.setAnimationEnabled(false)
    expect(motion.isLowPower).toBe(true)
    expect(motion.getAnimationEnabled()).toBe(false)
    expect(localStorage.getItem(ANIMATIONS_ENABLED_KEY)).toBe("false")

    motion.setAnimationEnabled(true)
    expect(motion.isLowPower).toBe(false)
    expect(motion.getAnimationEnabled()).toBe(true)
    expect(localStorage.getItem(ANIMATIONS_ENABLED_KEY)).toBe("true")
  })
})
