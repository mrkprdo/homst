/*
 * Web Push handlers.
 *
 * This file lives in `public/` and is imported by the Workbox-generated
 * service worker via `workbox.importScripts` (see vite.config.ts). It shares
 * the service worker's global scope, so the listeners below run alongside
 * Workbox's precaching/routing.
 *
 * Payload shape comes from the API's push module:
 *   { title, body, event_id, start_at, minutes_before, all_day, url, tag }
 */

self.addEventListener("push", (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    data = { body: event.data ? event.data.text() : "" }
  }

  const options = {
    body: data.body || "",
    icon: "/icon-192.svg",
    badge: "/icon-192.svg",
    tag: data.tag || data.event_id || undefined,
    renotify: Boolean(data.tag || data.event_id),
    data: { url: data.url || "/" },
  }

  event.waitUntil(self.registration.showNotification(data.title || "HOMST reminder", options))
})

self.addEventListener("notificationclick", (event) => {
  event.notification.close()
  const url = (event.notification.data && event.notification.data.url) || "/"

  event.waitUntil(
    (async () => {
      const clientList = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      })
      for (const client of clientList) {
        if ("focus" in client) {
          await client.focus()
          // Navigate to the intent (event or announcement). The app reads the
          // query once and opens the matching detail view.
          try {
            const target = new URL(url, self.location.origin).href
            if (client.url !== target && "navigate" in client) {
              await client.navigate(target)
            }
          } catch {
            // The open window is still focused if navigation is unavailable.
          }
          return
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url)
    })(),
  )
})
