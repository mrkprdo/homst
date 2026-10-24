import { describe, expect, it } from "vitest"
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
})
