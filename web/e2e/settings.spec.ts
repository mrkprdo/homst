import { test, expect } from "@playwright/test"
import { setupApiMocks, completeOnboarding } from "./mocks"

test.describe("Settings", () => {
  test.describe.configure({ mode: "serial" })
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page)
    await completeOnboarding(page)
  })

  async function openSettings(page: any) {
    await page.locator(".app-nav button").nth(3).click()
    await page.waitForTimeout(300)
  }

  test("settings panel shows all sections", async ({ page }) => {
    await openSettings(page)
    await expect(page.locator(".settings-panel")).toBeVisible()
    await expect(page.locator(".card-title").first()).toBeVisible()
  })

  test("reminders card offers display and push channels plus a single test button", async ({ page }) => {
    await openSettings(page)
    const card = page.locator(".settings-card").filter({ hasText: "Reminders" })
    await expect(card).toBeVisible()
    await expect(card.locator(".setting-row")).toHaveCount(3)
    await expect(card.getByRole("button", { name: "Send test to all clients" })).toBeVisible()
  })

  test("default reminder select persists to notifications settings", async ({ page }) => {
    await openSettings(page)
    const card = page.locator(".settings-card").filter({ hasText: "Reminders" })
    const select = card.locator("select.reminder-default-select")
    await expect(select).toBeVisible()
    await expect(select).toHaveValue("")

    const requestPromise = page.waitForRequest(
      (r) => r.url().includes("/household/settings") && r.method() === "PATCH",
    )
    await select.selectOption("60")
    const payload = JSON.parse((await requestPromise).postData() || "{}")
    expect(payload.settings.notifications.defaultReminderMinutes).toBe(60)
  })

  test("default reminder select fits inside the reminders card", async ({ page }) => {
    await openSettings(page)
    const card = page.locator(".settings-card").filter({ hasText: "Reminders" })
    const cardBox = (await card.boundingBox())!
    const selectBox = (await card.locator("select.reminder-default-select").boundingBox())!
    // The select must not overflow the card's right edge.
    expect(selectBox.x + selectBox.width).toBeLessThanOrEqual(cardBox.x + cardBox.width + 1)
  })

  test("Send test to all clients reaches screens and phones", async ({ page }) => {
    await openSettings(page)
    const card = page.locator(".settings-card").filter({ hasText: "Reminders" })
    const requestPromise = page.waitForRequest(
      (r) => r.url().includes("/notifications/test") && r.method() === "POST",
    )
    await card.getByRole("button", { name: "Send test to all clients" }).click()
    const payload = JSON.parse((await requestPromise).postData() || "{}")
    expect(payload.channels).toEqual(["hud", "push"])
    await expect(card.locator(".reminder-result")).toHaveCount(2)
    await expect(card.locator(".reminder-result").first()).toContainText("Display:")
    await expect(card.locator(".reminder-result").last()).toContainText("Phone:")
  })

  test("accent color has 5 swatch options", async ({ page }) => {
    await openSettings(page)
    await expect(page.locator(".color-swatch")).toHaveCount(5)
  })

  test("can select each accent color", async ({ page }) => {
    await openSettings(page)
    const swatches = page.locator(".color-swatch")
    for (let i = 0; i < 5; i++) {
      await swatches.nth(i).click()
      await page.waitForTimeout(100)
    }
  })

  test("font size has 4 options", async ({ page }) => {
    await openSettings(page)
    const buttons = page.locator(".settings-card").nth(2).locator(".segmented-btn")
    await expect(buttons).toHaveCount(4)
  })

  test("can cycle through all font sizes", async ({ page }) => {
    await openSettings(page)
    const buttons = page.locator(".settings-card").nth(2).locator(".segmented-btn")
    for (let i = 0; i < 4; i++) {
      await buttons.nth(i).click()
      await page.waitForTimeout(100)
    }
  })

  test("theme has 3 options for the default Futur preset", async ({ page }) => {
    await openSettings(page)
    const cards = page.locator(".theme-card")
    await expect(cards).toHaveCount(3)
    await expect(cards.nth(0)).toContainText("Day")
    await expect(cards.nth(1)).toContainText("Night")
    await expect(cards.nth(2)).toContainText("Auto")
  })

  test("theme presets are Futur (default) and Clay-o", async ({ page }) => {
    await openSettings(page)
    const presets = page.locator(".preset-card")
    await expect(presets).toHaveCount(2)
    await expect(presets.nth(0)).toContainText("Futur")
    await expect(presets.nth(1)).toContainText("Clay-o")
    await expect(presets.nth(0)).toHaveClass(/active/)
  })

  test("can switch between all themes", async ({ page }) => {
    await openSettings(page)
    const cards = page.locator(".theme-card")
    await cards.nth(0).click()
    await cards.nth(1).click()
    await cards.nth(2).click()
  })

  test("settings sections exist", async ({ page }) => {
    await openSettings(page)
    const sections = page.locator(".settings-card")
    await expect(sections).toHaveCount(6)
  })
})
