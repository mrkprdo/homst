import { describe, expect, it } from "vitest"
import { activeLineIndex, parseLrc } from "@/lib/lrc"

describe("parseLrc", () => {
  it("returns no lines for empty or missing input", () => {
    expect(parseLrc(null)).toEqual([])
    expect(parseLrc(undefined)).toEqual([])
    expect(parseLrc("")).toEqual([])
  })

  it("parses timestamps and sorts them by time", () => {
    const lines = parseLrc([
      "[00:10.00]second",
      "[00:05.50]first",
      "[01:02.345]third",
    ].join("\n"))

    expect(lines).toEqual([
      { timeMs: 5_500, text: "first" },
      { timeMs: 10_000, text: "second" },
      { timeMs: 62_345, text: "third" },
    ])
  })

  it("reads every fraction width and the colon spelling", () => {
    const lines = parseLrc([
      "[00:01.3]tenths",
      "[00:02.34]hundredths",
      "[00:03:567]colon",
      "[00:04]whole",
    ].join("\n"))

    expect(lines.map(l => l.timeMs)).toEqual([1_300, 2_340, 3_567, 4_000])
  })

  it("repeats a line that carries several timestamps", () => {
    const lines = parseLrc("[00:10.00][01:10.00]chorus")

    expect(lines).toEqual([
      { timeMs: 10_000, text: "chorus" },
      { timeMs: 70_000, text: "chorus" },
    ])
  })

  it("drops metadata tags, blank lines and word-level timings", () => {
    const raw = [
      "[ar:Fleetwood Mac]",
      "[ti:The Chain]",
      "[00:27.93]",
      "[00:30.88] <00:30.88>Listen <00:31.20>to the wind",
      "not a lyric line",
    ].join("\n")

    expect(parseLrc(raw)).toEqual([
      { timeMs: 30_880, text: "Listen to the wind" },
    ])
  })
})

describe("activeLineIndex", () => {
  const lines = parseLrc([
    "[00:10.00]one",
    "[00:20.00]two",
    "[00:30.00]three",
  ].join("\n"))

  it("is -1 before the first line", () => {
    expect(activeLineIndex(lines, 0)).toBe(-1)
    expect(activeLineIndex(lines, 9_999)).toBe(-1)
  })

  it("returns the last line whose timestamp has passed", () => {
    expect(activeLineIndex(lines, 10_000)).toBe(0)
    expect(activeLineIndex(lines, 25_000)).toBe(1)
    expect(activeLineIndex(lines, 99_999)).toBe(2)
  })

  it("has nothing to point at without lines", () => {
    expect(activeLineIndex([], 10_000)).toBe(-1)
  })
})
