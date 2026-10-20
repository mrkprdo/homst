import { test, expect, type Page } from "@playwright/test"
import { setupApiMocks, completeOnboarding } from "./mocks"

/**
 * Reminder heads-up display (HUD).
 *
 * Reminders reach the kiosk over the `/api/stream` SSE connection. We stand in
 * for the API by fulfilling that request with a static `text/event-stream`
 * body, which the real EventSource parses and dispatches as events.
 */

function reminder(id: string, title: string, minutesFromNow: number, extra: Record<string, unknown> = {}) {
  return {
    event_id: id,
    title,
    start_at: new Date(Date.now() + minutesFromNow * 60_000).toISOString(),
    minutes_before: 30,
    all_day: false,
    ...extra,
  }
}

async function bootWithReminders(page: Page, payloads: Record<string, unknown>[]) {
  await setupApiMocks(page)
  const body = payloads
    .map((p) => `event: reminder.due\ndata: ${JSON.stringify(p)}\n\n`)
    .join("")
  await page.route("**/api/stream", (route) =>
    route.fulfill({ status: 200, contentType: "text/event-stream", body }),
  )
  await completeOnboarding(page)
  await page.waitForTimeout(700)
}

test.describe("Reminder HUD", () => {
  test.describe.configure({ mode: "serial" })

  test("shows a heads-up alert for each due reminder", async ({ page }) => {
    await bootWithReminders(page, [
      reminder("ev-1", "Dentist appointment", 5),
      reminder("ev-2", "Pick up groceries", 30),
    ])

    await expect(page.locator(".hud-card")).toHaveCount(2)
    await expect(page.locator(".hud-card--display")).toHaveCount(2)
    await expect(page.locator(".hud-backdrop")).toBeVisible()
    await expect(page.locator(".hud-card").first()).toHaveAttribute("role", "alert")
    await expect(page.locator(".hud-title").first()).toContainText("Dentist appointment")
    await expect(page.locator(".hud-when").first()).toContainText("In 5 min")
  })

  test("a reminder that is starting now is labelled as such", async ({ page }) => {
    await bootWithReminders(page, [reminder("ev-now", "Stand up and stretch", 0.4)])
    await expect(page.locator(".hud-card")).toHaveCount(1)
    await expect(page.locator(".hud-when")).toContainText("Starting now")
  })

  test("duplicate deliveries are ignored", async ({ page }) => {
    const dup = reminder("ev-dup", "Only once", 10)
    await bootWithReminders(page, [dup, dup])
    await expect(page.locator(".hud-card")).toHaveCount(1)
  })

  test("dismissing a reminder removes its alert", async ({ page }) => {
    await bootWithReminders(page, [reminder("ev-dismiss", "Trash day", 15)])
    await expect(page.locator(".hud-card")).toHaveCount(1)

    await page.locator(".hud-dismiss").first().click()
    await expect(page.locator(".hud-card")).toHaveCount(0)
  })
})
