import { describe, it, expect } from "vitest"
import { getInitials, hashString, hashToColor, formatDate, formatTime } from "@/utils/helpers"
import { COLORS } from "@/__tests__/constants"

describe("helpers", () => {
  describe("getInitials", () => {
    it("returns initials for two-word name", () => {
      expect(getInitials("John Doe")).toBe("JD")
    })

    it("returns single initial for one-word name", () => {
      expect(getInitials("Alice")).toBe("A")
    })

    it("handles multiple spaces", () => {
      expect(getInitials("John   Michael   Doe")).toBe("JM")
    })

    it("handles empty string", () => {
      expect(getInitials("")).toBe("")
    })

    it("handles leading/trailing spaces", () => {
      expect(getInitials("  Jane Doe  ")).toBe("JD")
    })
  })

  describe("hashString", () => {
    it("returns a number", () => {
      const result = hashString("hello")
      expect(typeof result).toBe("number")
      expect(result).toBeGreaterThanOrEqual(0)
    })

    it("same input produces same hash", () => {
      expect(hashString("test")).toBe(hashString("test"))
    })

    it("different inputs produce different hashes", () => {
      expect(hashString("hello")).not.toBe(hashString("world"))
    })
  })

  describe("hashToColor", () => {
    it("returns one of the 5 palette colors", () => {
      for (let i = 0; i < 20; i++) {
        const result = hashToColor(`user-${i}`)
        expect(COLORS).toContain(result)
      }
    })

    it("is deterministic", () => {
      expect(hashToColor("alice")).toBe(hashToColor("alice"))
    })

    it("distributes across palette", () => {
      const results = new Set(Array.from({ length: 100 }, (_, i) => hashToColor(`u${i}`)))
      expect(results.size).toBeGreaterThan(1)
    })
  })

  describe("formatDate", () => {
    it("formats ISO date string as en-US", () => {
      const result = formatDate("2026-05-01T12:00:00Z")
      expect(result).toMatch(/May\s+1,?\s+2026/)
    })

    it("handles different dates", () => {
      const d1 = formatDate("2026-01-01T12:00:00Z")
      expect(d1).toMatch(/Jan/)
      expect(d1).toMatch(/2026/)
    })
  })

  describe("formatTime", () => {
    it("formats time string with en-US locale", () => {
      const result = formatTime("2026-05-01T14:30:00Z")
      expect(result).toMatch(/\d{1,2}:\d{2}\s*(AM|PM)/)
    })

    it("returns a non-empty string", () => {
      expect(formatTime("2026-05-01T00:00:00Z")).toBeTruthy()
      expect(formatTime("2026-05-01T12:00:00Z")).toBeTruthy()
      expect(formatTime("2026-05-01T09:05:00Z")).toBeTruthy()
    })
  })
})
