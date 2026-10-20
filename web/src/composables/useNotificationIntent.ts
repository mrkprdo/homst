/** Read one-shot navigation intents from notification taps. */
export type NotificationIntent =
  | { type: "event"; id: string; startAt: string | null }
  | { type: "announcement"; id: string }

let consumed = false

function parseIntent(): NotificationIntent | null {
  if (typeof window === "undefined") return null
  const params = new URLSearchParams(window.location.search)

  const eventId = params.get("event")
  if (eventId) {
    return { type: "event", id: eventId, startAt: params.get("event_start") }
  }

  const announcementId = params.get("announcement")
  if (announcementId) {
    return { type: "announcement", id: announcementId }
  }

  return null
}

function clearIntentFromUrl() {
  const url = new URL(window.location.href)
  url.searchParams.delete("event")
  url.searchParams.delete("event_start")
  url.searchParams.delete("announcement")
  window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`)
}

export function useNotificationIntent() {
  /** Return the pending intent once, and remove it from the address bar. */
  function take(): NotificationIntent | null {
    if (consumed) return null
    const intent = parseIntent()
    if (!intent) return null
    consumed = true
    clearIntentFromUrl()
    return intent
  }

  return { take }
}

export function _resetNotificationIntent() {
  consumed = false
}
