import { test, expect } from "@playwright/test"
import { setupApiMocks, openManualEventQuickAdd } from "./mocks"

test.describe.configure({ mode: "serial" })
test("full user journey: onboarding → events → views → edit", async ({ page }) => {
  await setupApiMocks(page)
  await page.goto("/onboarding")
  test.setTimeout(120000)

  await expect(page.locator(".onboarding-overlay")).toBeVisible()
  await expect(page.locator(".step-title")).toContainText("Welcome")

  await page.locator("input").first().fill("Smith Family")
  await page.getByRole("button", { name: "Next" }).click()

  await expect(page.locator(".step-title")).toContainText("Members")
  await page.locator(".member-input").nth(0).fill("Alice")

  await page.getByRole("button", { name: "Add member" }).click()
  await page.locator(".member-input").nth(1).fill("Bob")

  await page.getByRole("button", { name: "Add member" }).click()
  await page.locator(".member-input").nth(2).fill("Carol")

  await expect(page.locator(".member-row")).toHaveCount(3)
  await page.getByRole("button", { name: "Next" }).click()

  await expect(page.locator(".step-title")).toContainText("Holiday")
  await page.getByRole("button", { name: "Next" }).click()

  await expect(page.locator(".step-title")).toContainText("All set")
  await expect(page.locator(".review-value").nth(0)).toContainText("Smith Family")
  await expect(page.locator(".review-value").nth(1)).toContainText("Alice, Bob, Carol")
  await page.getByRole("button", { name: "Confirm" }).click()
  await page.waitForTimeout(500)

  await expect(page.locator(".app-nav")).toBeVisible()

  await page.locator(".app-nav button").nth(1).click()
  await page.waitForTimeout(300)
  await expect(page.locator(".month-view")).toBeVisible()

  await openManualEventQuickAdd(page)
  await page.locator(".quick-add-form input").first().fill("Team Standup")
  await page.locator(".quick-add-form select").nth(1).selectOption({ index: 1 })
  await page.getByRole("button", { name: "Create Event" }).click()
  await page.waitForTimeout(400)
  await expect(page.locator(".drawer")).not.toBeVisible()

  await openManualEventQuickAdd(page)
  await page.locator(".quick-add-form input").first().fill("Sprint Planning")
  await page.locator(".quick-add-form select").nth(1).selectOption({ index: 2 })
  await page.getByRole("button", { name: "Create Event" }).click()
  await page.waitForTimeout(400)

  await openManualEventQuickAdd(page)
  await page.locator(".quick-add-form input").first().fill("Design Review")
  await page.locator(".quick-add-form select").nth(1).selectOption({ index: 3 })
  await page.getByRole("button", { name: "Create Event" }).click()
  await page.waitForTimeout(400)

  const todayCell = page.locator(".day-cell.today")
  await expect(todayCell).toBeVisible()
  await page.waitForTimeout(1000)

  await page.locator(".segmented-btn").nth(1).click()
  await page.waitForTimeout(300)
  await expect(page.locator(".week-view")).toBeVisible()
  await expect(page.locator(".week-col-header")).toHaveCount(7)

  await expect(page.locator(".week-col-header.today")).toBeVisible()

  await page.locator(".segmented-btn").nth(2).click()
  await page.waitForTimeout(300)
  await expect(page.locator(".day-view")).toBeVisible()
  await expect(page.locator(".day-banner")).toBeVisible()
  await expect(page.locator(".day-hour-cell")).toHaveCount(24)

  await page.waitForTimeout(500)

  const navArrows = page.locator(".nav-arrow")
  const labelBefore = await page.locator(".nav-label").textContent()
  await navArrows.nth(1).click()
  await page.waitForTimeout(300)
  const labelAfter = await page.locator(".nav-label").textContent()
  expect(labelAfter).not.toBe(labelBefore)

  await navArrows.nth(0).click()
  await page.waitForTimeout(300)

  await page.locator(".segmented-btn").nth(0).click()
  await page.waitForTimeout(300)
  await expect(page.locator(".month-view")).toBeVisible()

  await expect(page.locator(".day-cell.today")).toBeVisible()

  await page.locator(".nav-item--profile").click()
  await page.waitForTimeout(500)
  await expect(page.locator(".drawer")).toBeVisible()
  await expect(page.locator(".member-detail")).toBeVisible()
  await expect(page.locator(".md-members .md-member-row").first()).toBeVisible()

  await page.locator(".close-btn").click()
  await page.waitForTimeout(400)

  await page.locator('.nav-item[aria-label="Settings"]').click()
  await page.waitForTimeout(300)
  await expect(page.locator(".settings-panel")).toBeVisible()
  await expect(page.locator(".card-title")).toHaveCount(13)

  await page.locator(".color-swatch").nth(2).click()
  await page.waitForTimeout(200)

  const fontSizeButtons = page
    .locator(".settings-card")
    .filter({ hasText: "Text Size" })
    .locator(".segmented-btn")
  await fontSizeButtons.nth(3).click()
  await page.waitForTimeout(200)

  const themeCards = page.locator(".theme-card")
  await themeCards.nth(0).click()
  await page.waitForTimeout(200)
})