import { test, expect } from "@playwright/test"
import { setupApiMocks, completeOnboarding, addMockEvent, addMockTask } from "./mocks"

/**
 * Home dashboard (kiosk) — widgets, slideshow, and the layout lock.
 * The home panel is the default view, so no navigation is required.
 */
test.describe("Home dashboard", () => {
  test.describe.configure({ mode: "serial" })

  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page)
    // Holidays are folded into the event list by useEvents; clear them so the
    // "empty state" assertions don't depend on the current date.
    await page.route("**/api/v1/holidays", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: "[]" }),
    )
    // App.vue loads the photo library on boot for the slideshow widget.
    await page.route("**/api/v1/photos", async (route) => {
      if (route.request().method() === "GET") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify([
            { id: "ph1", url: "/uploads/photos/a.png", selected: true, created_at: "2026-01-01T00:00:00Z" },
            { id: "ph2", url: "/uploads/photos/b.png", selected: false, created_at: "2026-01-02T00:00:00Z" },
          ]),
        })
      } else {
        await route.continue()
      }
    })
    await completeOnboarding(page, "Cedar House")
    await page.waitForTimeout(400)
  })

  test("renders every widget on the home panel", async ({ page }) => {
    await expect(page.locator(".home-view")).toBeVisible()
    await expect(page.locator(".widget")).toHaveCount(7)

    await expect(page.locator(".datetime-house")).toContainText("Cedar House")
    await expect(page.locator(".datetime-date")).toBeVisible()
    await expect(page.locator(".datetime-time")).toBeVisible()

    for (const title of ["Today's Schedule", "Weather", "To Do", "Photos", "Spotify"]) {
      await expect(page.locator(".widget").filter({ hasText: title }).first()).toBeVisible()
    }
    // Mini calendar renders this month
    const monthName = new Date().toLocaleString("en-US", { month: "long", year: "numeric" })
    await expect(page.locator(".widget").filter({ hasText: monthName })).toBeVisible()
    await expect(page.locator(".mini-cal-day")).not.toHaveCount(0)
  })

  test("widgets without data show their empty states", async ({ page }) => {
    await expect(page.locator(".widget").filter({ hasText: "Today's Schedule" })).toContainText("No events today")
    await expect(page.locator(".widget").filter({ hasText: "To Do" })).toContainText("All clear")
  })

  test("photos widget shows only the selected photo", async ({ page }) => {
    await expect(page.locator(".photos-img")).toBeVisible()
    await expect(page.locator(".photos-img")).toHaveAttribute("src", "/uploads/photos/a.png")
  })

  test("seeded task appears in the To Do widget", async ({ page }) => {
    addMockTask({ title: "Water the plants", status: "todo" })
    await page.reload()
    await page.waitForTimeout(700)
    await expect(page.locator(".widget").filter({ hasText: "To Do" })).toContainText("Water the plants")
  })

  test("seeded event appears in today's schedule", async ({ page }) => {
    // Local noon today guarantees the event lands on the local "today" regardless of timezone.
    const start = new Date()
    start.setHours(12, 0, 0, 0)
    const end = new Date(start)
    end.setHours(13)
    addMockEvent({ title: "Team standup", start_at: start.toISOString(), end_at: end.toISOString() })
    await page.reload()
    await page.waitForTimeout(700)
    await expect(page.locator(".widget").filter({ hasText: "Today's Schedule" })).toContainText("Team standup")
    // Event day is marked on the mini calendar (chips in detailed tiles, dots when compact)
    await expect(page.locator(".mini-cal-chip:visible, .event-dot:visible").first()).toBeVisible()
  })

  test("mini calendar date click opens that date in the calendar", async ({ page }) => {
    const day = page.locator(".mini-cal-day:not(.mini-cal-day--empty)").nth(10)
    const dayNumber = (await day.locator(".mini-cal-day__num").innerText()).trim()
    await day.click()

    await expect(page.locator(".calendar-view")).toBeVisible()
    await expect(page.locator(".day-cell.selected .day-num")).toHaveText(dayNumber)
  })

  test("schedule event click opens its date and event detail", async ({ page }) => {
    const start = new Date()
    start.setHours(12, 0, 0, 0)
    const end = new Date(start)
    end.setHours(13)
    addMockEvent({ title: "Linked standup", start_at: start.toISOString(), end_at: end.toISOString() })
    await page.reload()
    await page.waitForTimeout(700)

    await page.locator(".widget").filter({ hasText: "Today's Schedule" })
      .locator(".schedule-row").filter({ hasText: "Linked standup" }).click()

    await expect(page.locator(".calendar-view")).toBeVisible()
    await expect(page.locator(".edp-title")).toHaveText("Linked standup")
    await expect(page.locator(".day-cell.selected .day-num")).toHaveText(String(start.getDate()))
  })

  test("lock toggle switches the canvas into edit mode", async ({ page }) => {
    const toggle = page.locator(".lock-toggle")
    await expect(toggle).toHaveAttribute("aria-label", "Unlock layout")
    await expect(page.locator(".widget-canvas")).not.toHaveClass(/is-editing/)

    await toggle.click()
    await expect(toggle).toHaveAttribute("aria-label", "Lock layout")
    await expect(page.locator(".widget-canvas")).toHaveClass(/is-editing/)
    // 6 columns × 6 rows of helper cells, one handle set per widget
    await expect(page.locator(".grid-cell-bg")).toHaveCount(36)
    await expect(page.locator(".drag-handle")).toHaveCount(7)
    await expect(page.locator(".resize-handle")).toHaveCount(7)

    await toggle.click()
    await expect(page.locator(".widget-canvas")).not.toHaveClass(/is-editing/)
    await expect(page.locator(".grid-cell-bg")).toHaveCount(0)
  })

  test("schedule header link jumps to the calendar panel", async ({ page }) => {
    await page
      .locator(".widget")
      .filter({ hasText: "Today's Schedule" })
      .getByRole("button", { name: /Calendar/ })
      .click()
    await expect(page.locator(".home-view")).not.toBeVisible()
  })
})
