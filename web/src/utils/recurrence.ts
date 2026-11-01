import type { Event } from "@/composables/useEvents"

export interface RecurrenceRule {
  freq?: string
  until?: string | null
  count?: number | null
}

/** Hard stop so a corrupt rule can never spin the render loop. */
const MAX_INSTANCES = 2000

function stepDate(freq: string, d: Date): Date | null {
  const next = new Date(d)
  switch (freq) {
    case "daily":    next.setDate(next.getDate() + 1); break
    case "weekly":   next.setDate(next.getDate() + 7); break
    case "biweekly": next.setDate(next.getDate() + 14); break
    case "monthly":  next.setMonth(next.getMonth() + 1); break
    case "yearly":   next.setFullYear(next.getFullYear() + 1); break
    default:         return null
  }
  return next
}

function stepMs(freq: string): number {
  switch (freq) {
    case "daily":    return 86_400_000
    case "weekly":   return 7 * 86_400_000
    case "biweekly": return 14 * 86_400_000
    default:         return 0
  }
}

/**
 * Expand a recurring event into concrete occurrences inside [from, to].
 *
 * Events are stored as a single base row (`startAt` = first occurrence), so
 * anything that filters by real dates has to expand them first. Occurrences
 * keep the base id with a `::<index>` suffix; consumers strip it before
 * opening the event detail.
 */
export function expandRecurringEvent(ev: Event, from: Date, to: Date): Event[] {
  const rec = ev.recurrence as RecurrenceRule | null
  if (!rec?.freq) return [ev]

  const origStart = new Date(ev.startAt)
  if (Number.isNaN(origStart.getTime())) return [ev]

  const durationMs = Math.max(new Date(ev.endAt ?? ev.startAt).getTime() - origStart.getTime(), 0)
  const until = rec.until ? new Date(rec.until) : null
  const endBound = until && !Number.isNaN(until.getTime()) ? until : to
  const maxCount = typeof rec.count === "number" && rec.count > 0 ? rec.count : Infinity

  // Unknown frequencies cannot be stepped — treat them as one-off events.
  if (!stepDate(rec.freq, origStart)) return [ev]

  let cursor = origStart
  let index = 0

  // Fast-forward: skip whole iterations before `from` for fixed-length steps.
  const msStep = stepMs(rec.freq)
  if (cursor < from && msStep > 0) {
    const skip = Math.max(0, Math.floor((from.getTime() - cursor.getTime()) / msStep))
    cursor = new Date(cursor.getTime() + skip * msStep)
    index = skip
  }

  const instances: Event[] = []
  while (
    cursor <= to &&
    cursor <= endBound &&
    index < maxCount &&
    instances.length < MAX_INSTANCES
  ) {
    if (cursor >= from) {
      instances.push({
        ...ev,
        id: `${ev.id}::${index}`,
        startAt: cursor.toISOString(),
        endAt: new Date(cursor.getTime() + durationMs).toISOString(),
      })
    }
    cursor = stepDate(rec.freq, cursor)!
    index++
  }

  return instances.length ? instances : [ev]
}

/** Expand every recurring event in a list over the given window. */
export function expandEvents(events: Event[], from: Date, to: Date): Event[] {
  return events.flatMap(ev => (ev.recurrence ? expandRecurringEvent(ev, from, to) : [ev]))
}
