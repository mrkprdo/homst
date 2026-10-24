import { test, expect } from "@playwright/test"

/**
 * A push tap while the household server is unreachable must show the text that
 * the service worker stored on the device, not a blank PWA shell.
 *
 * Playwright cannot deliver a real Web Push here, so seed the same IndexedDB
 * record the service worker writes and make every API request fail.
 */
test("a notification tap is readable while the server is unreachable", async ({ page }) => {
  await page.route(/\/api\/(v1\/|health|stream)/, route => route.abort("failed"))
  // The household was already set up on this device before the phone left the LAN.
  await page.addInitScript(() => localStorage.setItem("homst-household-complete", "true"))

  // Establish the origin, then seed the offline copy.
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

  // Closing the sheet leaves a banner that can reopen the stored copy.
  await page.locator(".offline-push__done").click()
  const banner = page.locator(".server-offline")
  await expect(banner).toContainText("HOMST local server is out of reach")
  await banner.getByRole("button", { name: "Read notifications" }).click()
  await expect(sheet).toBeVisible()
})
