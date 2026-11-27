
const PUSH_DB_NAME = "homst-push"
const PUSH_DB_VERSION = 1
const PUSH_STORE = "notifications"
const MAX_STORED_PUSHES = 50

let pushDbPromise = null

function openPushDb() {
  if (pushDbPromise) return pushDbPromise

  const promise = new Promise((resolve, reject) => {
    if (!self.indexedDB) {
      reject(new Error("IndexedDB is unavailable"))
      return
    }

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

  pushDbPromise = promise
  promise.catch(() => {
    if (pushDbPromise === promise) pushDbPromise = null
  })
  return promise
}

async function rememberPush(data, id, url) {
  try {
    const db = await openPushDb()
    await new Promise((resolve, reject) => {
      const tx = db.transaction(PUSH_STORE, "readwrite")
      const store = tx.objectStore(PUSH_STORE)

      store.put({
        id,
        title: data.title || "HOMST reminder",
        body: data.body || "",
        url: url || "/",
        event_id: data.event_id || null,
        received_at: Date.now(),
      })

      let seen = 0
      const cursorRequest = store.index("received_at").openCursor(null, "prev")
      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result
        if (!cursor) return
        seen += 1
        if (seen > MAX_STORED_PUSHES) cursor.delete()
        cursor.continue()
      }

      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error)
    })
  } catch {
  }
}

self.addEventListener("push", (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    data = { body: event.data ? event.data.text() : "" }
  }

  const url = data.url || "/"
  const id =
    data.tag ||
    data.event_id ||
    `push-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

  const options = {
    body: data.body || "",
    icon: "/icon-192.svg",
    badge: "/icon-192.svg",
    tag: data.tag || data.event_id || undefined,
    renotify: Boolean(data.tag || data.event_id),
    data: { url, id },
  }

  event.waitUntil(
    Promise.all([
      rememberPush(data, id, url),
      self.registration.showNotification(data.title || "HOMST reminder", options),
    ]),
  )
})

self.addEventListener("notificationclick", (event) => {
  event.notification.close()
  const url = (event.notification.data && event.notification.data.url) || "/"
  const pushId = event.notification.data && event.notification.data.id

  event.waitUntil(
    (async () => {
      const clientList = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      })
      for (const client of clientList) {
        if ("focus" in client) {
          await client.focus()
          try {
            const target = new URL(url, self.location.origin)
            if (pushId && !target.searchParams.has("push")) {
              target.searchParams.set("push", pushId)
            }
            const href = target.href
            if (client.url !== href && "navigate" in client) {
              await client.navigate(href)
            }
          } catch {
          }
          return
        }
      }
      if (self.clients.openWindow) {
        try {
          const target = new URL(url, self.location.origin)
          if (pushId && !target.searchParams.has("push")) {
            target.searchParams.set("push", pushId)
          }
          return self.clients.openWindow(target.href)
        } catch {
          return self.clients.openWindow(url)
        }
      }
    })(),
  )
})
