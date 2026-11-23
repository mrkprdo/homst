import { describe, expect, it } from "vitest"
import { readableTextOn } from "@/utils/color"

describe("readableTextOn", () => {
  it("falls back to inverse text when the colour is not a hex value", () => {
    expect(readableTextOn("sage")).toBe("var(--color-textInverse)")
    expect(readableTextOn("#fff")).toBe("var(--color-textInverse)")
  })

  it("picks dark text on a light background", () => {
    expect(readableTextOn("#ffffff")).toBe("var(--color-textPrimary)")
    expect(readableTextOn("#f5e6c8")).toBe("var(--color-textPrimary)")
  })

  it("picks inverse text on a dark background", () => {
    expect(readableTextOn("#000000")).toBe("var(--color-textInverse)")
    expect(readableTextOn("#4b2142")).toBe("var(--color-textInverse)")
  })
})
