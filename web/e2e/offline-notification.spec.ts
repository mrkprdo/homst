import { test, expect } from "@playwright/test"

test("a notification tap is readable while the server is unreachable", async ({ page }) => {
  await page.route(/\/api\/(v1\/|health|stream)/, route => route.abort("failed"))
  await page.addInitScript(() => localStorage.setItem("homst-household-complete", "true"))

  await page.goto("/")
  const homeUrl = new URL("/", page.url()).href
  await page.evaluate(async () => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open("homst-push", 1)
      request.onupgradeneeded = () => {
        const db = request.result
        if (!db.objectStoreNames.contains("notifications")) {
          const store = db.createObjectStore("notifications", { keyPath: "id" })
          store.createIndex("received_at", "received_at")
        }
      }
      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        const db = request.result
        const tx = db.transaction("notifications", "readwrite")
        tx.objectStore("notifications").put({
          id: "push-offline-1",
          title: "Announcement from Mark",
          body: "Dinner is ready — come to the kitchen.",
          url: "/?announcement=ann-offline-1&push=push-offline-1",
          received_at: Date.now(),
        })
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
      }
    })
  })

  await page.goto("/?announcement=ann-offline-1&push=push-offline-1")

  const sheet = page.locator(".offline-push")
  await expect(sheet).toBeVisible()
  await expect(sheet.locator(".offline-push__title")).toHaveText("Announcement from Mark")
  await expect(sheet.locator(".offline-push__body")).toContainText("Dinner is ready")
  await expect(page).toHaveURL(homeUrl)

  await page.locator(".offline-push__done").click()
  const banner = page.locator(".server-offline")
  await expect(banner).toContainText("HOMST local server is out of reach")
  await banner.locator(".server-offline__trigger").click()
  await expect(banner).toHaveClass(/server-offline--pinned/)
  await banner.getByRole("button", { name: "Read notifications" }).click()
  await expect(sheet).toBeVisible()
})
