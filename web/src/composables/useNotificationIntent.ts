/** Read one-shot navigation intents from notification taps. */
export type NotificationIntent =
  | { type: "event"; id: string; startAt: string | null; pushId?: string }
  | { type: "announcement"; id: string; pushId?: string }
  /** A test/plain push with no deep link of its own. */
  | { type: "push"; id: string }

let consumed = false
let captured = false
let pending: NotificationIntent | null = null

function parseIntent(): NotificationIntent | null {
  if (typeof window === "undefined") return null
  const params = new URLSearchParams(window.location.search)
  const pushId = params.get("push") ?? undefined

  const eventId = params.get("event")
  if (eventId) {
    const intent: NotificationIntent = {
      type: "event",
      id: eventId,
      startAt: params.get("event_start"),
    }
    if (pushId) intent.pushId = pushId
    return intent
  }

  const announcementId = params.get("announcement")
  if (announcementId) {
    const intent: NotificationIntent = { type: "announcement", id: announcementId }
    if (pushId) intent.pushId = pushId
    return intent
  }

  if (pushId) return { type: "push", id: pushId }

  return null
}

function clearIntentFromUrl() {
  const url = new URL(window.location.href)
  url.searchParams.delete("event")
  url.searchParams.delete("event_start")
  url.searchParams.delete("announcement")
  url.searchParams.delete("push")
  window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`)
}

/**
 * Read the deep link before the router's initial navigation can redirect to
 * onboarding (which would drop the query). `main.ts` calls this at startup.
 */
export function captureNotificationIntent(): NotificationIntent | null {
  if (captured) return pending
  captured = true
  // Keep the query in the address bar until take(): a service-worker update
  // can reload the page before Vue mounts, and the reload must see it again.
  pending = parseIntent()
  return pending
}

export function useNotificationIntent() {
  /** Return the pending intent once, and remove it from the address bar. */
  function take(): NotificationIntent | null {
    if (consumed) return null
    const intent = captureNotificationIntent()
    if (!intent) return null
    consumed = true
    clearIntentFromUrl()
    return intent
  }

  return { take }
}

export function _resetNotificationIntent() {
  consumed = false
  captured = false
  pending = null
}
