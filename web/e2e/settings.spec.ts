import { test, expect } from "@playwright/test"
import { setupApiMocks, completeOnboarding } from "./mocks"

test.describe("Settings", () => {
  test.describe.configure({ mode: "serial" })
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page)
    await completeOnboarding(page)
  })

  async function openSettings(page: any) {
    await page.locator('.nav-item[aria-label="Settings"]').click()
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
    const buttons = page
      .locator(".settings-card")
      .filter({ hasText: "Text Size" })
      .locator(".segmented-btn")
    await expect(buttons).toHaveCount(4)
  })

  test("can cycle through all font sizes", async ({ page }) => {
    await openSettings(page)
    const buttons = page
      .locator(".settings-card")
      .filter({ hasText: "Text Size" })
      .locator(".segmented-btn")
    for (let i = 0; i < 4; i++) {
      await buttons.nth(i).click()
      await page.waitForTimeout(100)
    }
  })

  test("theme has 4 options for the default Futur preset", async ({ page }) => {
    await openSettings(page)
    const cards = page.locator(".theme-card")
    await expect(cards).toHaveCount(4)
    await expect(cards.nth(0)).toContainText("Day")
    await expect(cards.nth(1)).toContainText("Night")
    await expect(cards.nth(2)).toContainText("Auto")
    await expect(cards.nth(3)).toContainText("System")
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
    await cards.nth(3).click()
  })

  test("settings sections exist", async ({ page }) => {
    await openSettings(page)
    const sections = page.locator(".settings-card")
    await expect(sections).toHaveCount(13)
  })

  test("cards spread evenly across the masonry columns on a wall display", async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 })
    await openSettings(page)
    const columnHeights = await page.evaluate(() => {
      const root = document.querySelector(".settings-masonry") as HTMLElement
      const spans = new Map<number, { top: number; bottom: number }>()
      for (const el of Array.from(root.children) as HTMLElement[]) {
        const box = el.getBoundingClientRect()
        const x = Math.round(box.x)
        const span = spans.get(x) ?? { top: Number.POSITIVE_INFINITY, bottom: Number.NEGATIVE_INFINITY }
        spans.set(x, {
          top: Math.min(span.top, box.top),
          bottom: Math.max(span.bottom, box.bottom),
        })
      }
      return [...spans.values()].map((span) => span.bottom - span.top)
    })
    // Hand-pinned column breaks used to funnel every newer card into the last
    // column; the tallest column must now stay close to the shortest one.
    expect(columnHeights).toHaveLength(3)
    expect(Math.max(...columnHeights)).toBeLessThanOrEqual(Math.min(...columnHeights) * 1.35)
  })

  test("search narrows the cards and clears again", async ({ page }) => {
    await openSettings(page)
    const search = page.getByRole("searchbox", { name: "Search settings" })

    await search.fill("camera")
    await expect(page.locator(".settings-card--camera")).toBeVisible()
    await expect(page.locator(".settings-card--music")).toBeHidden()
    await expect(page.locator(".settings-search__count")).toHaveText("1 card")
    await expect
      .poll(() => page.evaluate(() => CSS.highlights.has("settings-search")))
      .toBe(true)

    await search.fill("no-such-setting")
    await expect(page.locator(".settings-search-empty")).toBeVisible()
    await expect(page.locator(".settings-card--music")).toBeHidden()

    await page.getByRole("button", { name: "Clear search" }).first().click()
    await expect(search).toHaveValue("")
    await expect(page.locator(".settings-card--music")).toBeVisible()
    await expect(page.locator(".settings-search-empty")).toHaveCount(0)
  })

  test("auto-hide navigation tucks the rail away and reveals it at the left edge", async ({ page }) => {
    await openSettings(page)
    const card = page.locator(".settings-card.settings-card--home")
    const nav = page.locator(".app-nav")

    const requestPromise = page.waitForRequest(
      (r) => r.url().includes("/household/settings") && r.method() === "PATCH",
    )
    await card.locator(".setting-row").filter({ hasText: "Auto-hide navigation" }).locator(".ui-toggle").click()
    expect(JSON.parse((await requestPromise).postData() || "{}").settings.screens.autoHideNav).toBe(true)

    await expect(nav).toHaveClass(/app-nav--autohide/)
    await page.mouse.move(700, 400)
    await expect(nav).toHaveClass(/app-nav--hidden/)

    // Reaching for the left edge reveals the rail again.
    await page.mouse.move(5, 400)
    await expect(nav).not.toHaveClass(/app-nav--hidden/)
    await expect(page.locator('.nav-item[aria-label="Calendar"]')).toBeVisible()
  })

  test("resetting the home layout asks for confirmation and saves the default", async ({ page }) => {
    await openSettings(page)
    const card = page.locator(".settings-card.settings-card--home")
    await card.getByRole("button", { name: "Reset layout" }).click()
    await expect(card).toContainText("Reset the home screen layout?")

    const requestPromise = page.waitForRequest(
      (r) => r.url().includes("/household/settings") && r.method() === "PATCH",
    )
    await card.getByRole("button", { name: "Reset", exact: true }).click()
    const payload = JSON.parse((await requestPromise).postData() || "{}")
    const layout = payload.settings.widgetLayout
    expect(layout).toHaveLength(9)
    expect(layout.find((w: any) => w.id === "photos")).toMatchObject({ col: 3, row: 1, w: 3, h: 5 })
    await expect(card).toContainText("Home layout reset to the default.")
  })
})
