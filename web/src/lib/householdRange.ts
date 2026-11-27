export interface HouseholdRange {
  from: string
  to: string
  months: string[]
}

export function monthKey(year: number, month: number): string {
  return `${year}-${month}`
}

export function adjacentMonth(
  year: number,
  month: number,
  delta: -1 | 1,
): { year: number; month: number } {
  if (delta === -1) return month === 0 ? { year: year - 1, month: 11 } : { year, month: month - 1 }
  return month === 11 ? { year: year + 1, month: 0 } : { year, month: month + 1 }
}

export function threeMonthRange(base = new Date()): HouseholdRange {
  const year = base.getFullYear()
  const month = base.getMonth()
  const prev = adjacentMonth(year, month, -1)
  const next = adjacentMonth(year, month, 1)
  return {
    from: new Date(prev.year, prev.month, 1).toISOString(),
    to: new Date(next.year, next.month + 1, 0, 23, 59, 59).toISOString(),
    months: [
      monthKey(prev.year, prev.month),
      monthKey(year, month),
      monthKey(next.year, next.month),
    ],
  }
}
