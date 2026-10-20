import type { NotificationIntent } from "@/composables/useNotificationIntent"

/**
 * A copy of a Web Push payload that the service worker stored on this device.
 * It lets the PWA show the notification text even when the household server is
 * out of reach (away from the LAN, no VPN).
 */
export interface StoredPush {
  id: string
  title: string
  body: string
  url: string
  event_id?: string | null
  received_at: number
}

export const PUSH_DB_NAME = "homst-push"
export const PUSH_DB_VERSION = 1
export const PUSH_STORE = "notifications"
export const MAX_STORED_PUSHES = 50

let dbPromise: Promise<IDBDatabase> | null = null

function openPushDb(): Promise<IDBDatabase> | null {
  if (typeof indexedDB === "undefined") return null
  if (dbPromise) return dbPromise

  const promise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(PUSH_DB_NAME, PUSH_DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(PUSH_STORE)) {
        const store = db.createObjectStore(PUSH_STORE, { keyPath: "id" })
        store.createIndex("received_at", "received_at")
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
    request.onblocked = () => reject(new Error("Push store is blocked"))
  })

  dbPromise = promise
  promise.catch(() => {
    if (dbPromise === promise) dbPromise = null
  })
  return promise
}

/** Most recent first, capped at {@link MAX_STORED_PUSHES}. */
export async function listStoredPushes(limit = MAX_STORED_PUSHES): Promise<StoredPush[]> {
  const open = openPushDb()
  if (!open) return []

  try {
    const db = await open
    const rows = await new Promise<StoredPush[]>((resolve, reject) => {
      const tx = db.transaction(PUSH_STORE, "readonly")
      const request = tx.objectStore(PUSH_STORE).getAll()
      request.onsuccess = () => resolve((request.result ?? []) as StoredPush[])
      request.onerror = () => reject(request.error)
    })
    return rows
      .filter(row => typeof row?.id === "string" && typeof row?.received_at === "number")
      .sort((a, b) => b.received_at - a.received_at)
      .slice(0, limit)
  } catch {
    // A missing/blocked database only means there is no offline copy.
    return []
  }
}

/** Find the push whose deep link matches the tap that opened the app. */
export function matchStoredPush(
  items: StoredPush[],
  intent: NotificationIntent | null,
): StoredPush | null {
  if (!intent) return items[0] ?? null

  // The service worker adds the exact notification id to the deep link, so a
  // tap always finds its own payload even if the URL repeats an event id.
  if (intent.type === "push") {
    return items.find(item => item.id === intent.id) ?? items[0] ?? null
  }
  if (intent.pushId) {
    const exact = items.find(item => item.id === intent.pushId)
    if (exact) return exact
  }

  for (const item of items) {
    try {
      const url = new URL(item.url, "https://homst.local")
      if (intent.type === "announcement") {
        if (url.searchParams.get("announcement") === intent.id) return item
        continue
      }
      if (url.searchParams.get("event") !== intent.id) continue
      if (intent.startAt && url.searchParams.get("event_start") !== intent.startAt) continue
      return item
    } catch {
      // Ignore malformed/legacy URLs and keep looking.
    }
  }
  return null
}

export function _resetPushStore() {
  dbPromise = null
}
