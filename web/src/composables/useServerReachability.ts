import { ref } from "vue"

/**
 * Whether this browser can reach the HOMST server.
 *
 * Web Push is one-way: a phone can receive notifications from anywhere, but
 * sending an announcement or firing a test needs a route back to the server.
 * When the phone is away from the LAN (and not on a VPN), API requests fail.
 * The shared state lets the shell and the action buttons explain that instead
 * of showing a generic "failed to fetch" error.
 */
const serverReachable = ref(true)

export const SERVER_UNREACHABLE_TITLE = "HOMST local server is out of reach"

let inFlight: Promise<boolean> | null = null

export function markServerReachable() {
  serverReachable.value = true
}

export function markServerUnreachable() {
  serverReachable.value = false
}

/**
 * Probe the local server. Any HTTP response means it is reachable; only a
 * network failure (including the timeout) marks it unreachable.
 */
export function checkServerReachable(timeoutMs = 4000): Promise<boolean> {
  if (typeof window === "undefined" || typeof fetch !== "function") {
    return Promise.resolve(true)
  }
  if (inFlight) return inFlight

  inFlight = (async () => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      await fetch("/api/health", {
        cache: "no-store",
        credentials: "include",
        signal: controller.signal,
      })
      markServerReachable()
      return true
    } catch {
      markServerUnreachable()
      return false
    } finally {
      clearTimeout(timer)
      inFlight = null
    }
  })()

  return inFlight
}

export function useServerReachability() {
  return { serverReachable, checkServerReachable }
}

export function _resetServerReachability() {
  serverReachable.value = true
  inFlight = null
}
