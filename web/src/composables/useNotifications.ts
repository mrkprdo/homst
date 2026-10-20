import { ref } from "vue"

export interface HudNotification {
  id: string
  title: string
  startAt: string | null
  minutesBefore: number | null
  allDay: boolean
}

export interface ReminderPayload {
  event_id?: string
  title?: string
  start_at?: string | null
  minutes_before?: number | null
  all_day?: boolean
  test?: boolean
}

const MAX_VISIBLE = 3

/** Cards linger briefly after the event starts so "at start time" reminders stay visible. */
export const START_GRACE_MS = 2 * 60 * 1000

/** setTimeout delay cap (~24.8 days) — larger values overflow. */
const MAX_TIMEOUT = 2_147_483_647

const notifications = ref<HudNotification[]>([])
const expiryTimers = new Map<string, ReturnType<typeof setTimeout>>()

function clearTimer(id: string) {
  const timer = expiryTimers.get(id)
  if (timer !== undefined) {
    clearTimeout(timer)
    expiryTimers.delete(id)
  }
}

function clearAllTimers() {
  for (const timer of expiryTimers.values()) clearTimeout(timer)
  expiryTimers.clear()
}

/** Add a reminder to the heads-up display; deduped, capped, and auto-expiring. */
function push(payload: ReminderPayload) {
  const id = `${payload.event_id ?? "event"}::${payload.start_at ?? Date.now()}`
  if (notifications.value.some(n => n.id === id)) return

  const notification: HudNotification = {
    id,
    title: payload.title || "Upcoming event",
    startAt: payload.start_at ?? null,
    minutesBefore: payload.minutes_before ?? null,
    allDay: !!payload.all_day,
  }

  // Auto-expire: once the event has started (plus a short grace) the reminder
  // is stale — drop it, or schedule its dismissal.
  if (notification.startAt) {
    const expiresAt = new Date(notification.startAt).getTime() + START_GRACE_MS
    const remaining = expiresAt - Date.now()
    if (Number.isNaN(remaining) || remaining <= 0) return
    expiryTimers.set(id, setTimeout(() => dismiss(id), Math.min(remaining, MAX_TIMEOUT)))
  }

  notifications.value.push(notification)

  if (notifications.value.length > MAX_VISIBLE) {
    const overflow = notifications.value.slice(0, notifications.value.length - MAX_VISIBLE)
    for (const dropped of overflow) clearTimer(dropped.id)
    notifications.value = notifications.value.slice(overflow.length)
  }
}

function dismiss(id: string) {
  clearTimer(id)
  notifications.value = notifications.value.filter(n => n.id !== id)
}

function clear() {
  clearAllTimers()
  notifications.value = []
}

export function useNotifications() {
  return { notifications, push, dismiss, clear }
}

export function _resetNotifications() {
  clearAllTimers()
  notifications.value = []
}
