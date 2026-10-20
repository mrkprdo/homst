import { test, expect } from "@playwright/test"
import { setupApiMocks, completeOnboarding } from "./mocks"

test.describe("Announcements", () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page)
    await completeOnboarding(page)
  })

  test("sends a broadcast from the display and removes it", async ({ page }) => {
    await page.locator('.nav-item[aria-label="Announcements"]').click()
    await expect(page.locator(".announcement-console")).toBeVisible()

    await page.locator("#announcement-message").fill("Dinner is ready")
    await page.getByRole("button", { name: "Send announcement" }).click()

    await expect(page.locator(".announcement-live__item")).toContainText("Dinner is ready")

    // The screen already lists the message, so the global banner stays out of
    // the way here. It appears as soon as you leave the announcement screen.
    await expect(page.locator(".announcement-card")).toHaveCount(0)
    await page.locator(".nav-logo").click()
    await expect(page.locator(".announcement-card--display")).toContainText("Dinner is ready")
    await expect(page.locator(".announcement-backdrop")).toBeVisible()

    await page.locator('.nav-item[aria-label="Announcements"]').click()
    await page.locator(".announcement-live__remove").click()
    await expect(page.locator(".announcement-live__item")).toHaveCount(0)
  })
})
