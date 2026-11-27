import { describe, it, expect } from "vitest"
import { panelLoaders, prefetchPanels } from "@/lib/panelPrefetch"

describe("panelPrefetch", () => {
  it("imports every panel chunk", async () => {
    const modules = await prefetchPanels()

    expect(modules).toHaveLength(Object.keys(panelLoaders).length)
    for (const module of modules) {
      expect((module as { default?: unknown }).default).toBeTruthy()
    }
  })
})
