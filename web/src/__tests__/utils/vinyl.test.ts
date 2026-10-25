import { afterEach, describe, expect, it, vi } from "vitest"
import { syncVinyl } from "@/lib/vinyl"

function fakeEl(animations: { startTime: number | null }[]) {
  const el = document.createElement("div")
  Object.defineProperty(el, "getAnimations", {
    configurable: true,
    value: () => animations,
  })
  return el
}

describe("syncVinyl", () => {
  it("pins every animation to the document timeline origin", () => {
    const animations = [{ startTime: 1234 }, { startTime: 99 }]
    syncVinyl(fakeEl(animations))

    // startTime 0 makes progress a function of wall-clock time only, which is
    // what keeps the card and the backdrop at the same angle.
    expect(animations.map((a) => a.startTime)).toEqual([0, 0])
  })

  it("tolerates elements without the Animations API", () => {
    const el = document.createElement("div")
    expect(() => syncVinyl(el)).not.toThrow()
    expect(() => syncVinyl(null)).not.toThrow()
  })

  it("leaves paused animations paused so a stopped record stays still", () => {
    const paused = { playState: "paused", startTime: null as number | null }
    const running = { playState: "running", startTime: 1234 }

    syncVinyl(fakeEl([paused, running]))

    // Setting startTime on a paused animation resumes it in the browser, so
    // the paused one must not be touched while the running one is synced.
    expect(paused.startTime).toBeNull()
    expect(running.startTime).toBe(0)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("retries when the animation is not resolvable yet", () => {
    const animation = { startTime: 1234 }
    let calls = 0
    const el = fakeEl([])
    Object.defineProperty(el, "getAnimations", {
      configurable: true,
      value: () => (++calls === 1 ? [] : [animation]),
    })
    // Run the retry immediately instead of waiting for the next frame.
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
      cb(0)
      return 1
    })

    syncVinyl(el)

    expect(calls).toBe(2)
    expect(animation.startTime).toBe(0)
  })

  it("gives up after three retries", () => {
    const getAnimations = vi.fn(() => [])
    const el = document.createElement("div")
    Object.defineProperty(el, "getAnimations", {
      configurable: true,
      value: getAnimations,
    })
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
      cb(0)
      return 1
    })

    expect(() => syncVinyl(el)).not.toThrow()
    expect(getAnimations).toHaveBeenCalledTimes(4)
  })
})
