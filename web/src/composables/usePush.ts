import { ref } from "vue"
import { pushApi } from "@/api/push"

const supported = ref(false)
const permission = ref<NotificationPermission>("default")
const subscribed = ref(false)
const busy = ref(false)
const error = ref<string | null>(null)
/** Human-readable reason push is unavailable — surfaced in the settings hint. */
const supportDetail = ref("")

/** Convert the base64url VAPID key into the byte array `subscribe()` expects. */
export function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/")
  const raw = atob(base64)
  const output = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i)
  return output
}

function detectSupport(): boolean {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    supportDetail.value = "no browser environment"
    return false
  }
  // Real browsers always set this boolean; jsdom leaves it undefined, so only
  // treat an explicit `false` as insecure.
  if (window.isSecureContext === false) {
    supportDetail.value =
      "this page isn't a secure context — the HTTPS certificate isn't trusted on this device"
    return false
  }
  const missing: string[] = []
  if (!("serviceWorker" in navigator)) missing.push("service workers")
  if (!("PushManager" in window)) missing.push("PushManager")
  if (!("Notification" in window)) missing.push("notifications")
  if (missing.length > 0) {
    supportDetail.value = `this browser doesn't expose ${missing.join(" or ")}`
    return false
  }
  supportDetail.value = ""
  return (
    typeof window !== "undefined" &&
    typeof navigator !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  )
}

function getRegistration(): Promise<ServiceWorkerRegistration | undefined> {
  return navigator.serviceWorker.getRegistration()
}

/** Fail fast instead of hanging when no service worker ever activates (e.g. dev). */
function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(message)), ms)),
  ])
}

/** Always call this before showing state — it also runs `detectSupport()`. */
async function refresh() {
  supported.value = detectSupport()
  if (!supported.value) {
    subscribed.value = false
    return
  }
  permission.value = Notification.permission
  try {
    const registration = await getRegistration()
    const sub = await registration?.pushManager.getSubscription()
    subscribed.value = !!sub
  } catch {
    subscribed.value = false
  }
}

/** Ask for permission, subscribe this device, and register it with the server. */
async function enable(): Promise<boolean> {
  if (!detectSupport()) {
    supported.value = false
    error.value = "Push isn't supported on this device"
    return false
  }
  busy.value = true
  error.value = null
  try {
    const outcome = await Notification.requestPermission()
    permission.value = outcome
    if (outcome !== "granted") {
      error.value = "Notifications are blocked — allow them in your browser settings"
      return false
    }

    const registration = await withTimeout(
      navigator.serviceWorker.ready,
      5000,
      "Push needs the installed app over HTTPS — build HOMST and open it over a trusted certificate",
    )
    const { key } = await pushApi.vapidPublicKey()
    const sub = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(key),
    })
    const json = sub.toJSON()
    await pushApi.subscribe({
      endpoint: sub.endpoint,
      keys: { p256dh: json.keys?.p256dh ?? "", auth: json.keys?.auth ?? "" },
      user_agent: navigator.userAgent,
    })
    subscribed.value = true
    return true
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Could not enable push"
    return false
  } finally {
    busy.value = false
  }
}

/** Unsubscribe this device and forget it on the server. */
async function disable(): Promise<boolean> {
  busy.value = true
  error.value = null
  try {
    const registration = await getRegistration()
    const sub = await registration?.pushManager.getSubscription()
    if (sub) {
      await pushApi.unsubscribe(sub.endpoint).catch(() => {})
      await sub.unsubscribe()
    }
    subscribed.value = false
    return true
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Could not turn off push"
    return false
  } finally {
    busy.value = false
  }
}

export function usePush() {
  return { supported, permission, subscribed, busy, error, supportDetail, refresh, enable, disable }
}

export function _resetPush() {
  supported.value = false
  permission.value = "default"
  subscribed.value = false
  busy.value = false
  error.value = null
  supportDetail.value = ""
}
