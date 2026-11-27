import { ref } from "vue"

const serverReachable = ref(true)

export const SERVER_UNREACHABLE_TITLE = "HOMST local server is out of reach"

let inFlight: Promise<boolean> | null = null

export function markServerReachable() {
  serverReachable.value = true
}

export function markServerUnreachable() {
  serverReachable.value = false
}

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
