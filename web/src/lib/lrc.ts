export interface LyricLine {
  timeMs: number
  text: string
}

const STAMP = /\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g
const WORD_STAMP = /<\d{1,3}:\d{2}(?:[.:]\d{1,3})?>/g

function fractionMs(frac: string | undefined): number {
  if (!frac) return 0
  return Number(frac.padEnd(3, "0"))
}

export function parseLrc(raw: string | null | undefined): LyricLine[] {
  if (!raw) return []

  const out: LyricLine[] = []
  for (const row of raw.split(/\r?\n/)) {
    const stamps = [...row.matchAll(STAMP)]
    if (!stamps.length) continue

    const text = row.replace(STAMP, "").replace(WORD_STAMP, "").trim()
    if (!text) continue

    for (const stamp of stamps) {
      out.push({
        timeMs: Number(stamp[1]) * 60_000 + Number(stamp[2]) * 1_000 + fractionMs(stamp[3]),
        text,
      })
    }
  }

  return out.sort((a, b) => a.timeMs - b.timeMs)
}

export function activeLineIndex(lines: LyricLine[], positionMs: number): number {
  let low = 0
  let high = lines.length - 1
  let found = -1
  while (low <= high) {
    const mid = (low + high) >> 1
    if (lines[mid]!.timeMs <= positionMs) {
      found = mid
      low = mid + 1
    } else {
      high = mid - 1
    }
  }
  return found
}
