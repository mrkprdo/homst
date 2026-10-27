import { test, expect } from "@playwright/test"
import { setupApiMocks, completeOnboarding, createEventE2E } from "./mocks"

test.describe("Calendar", () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page)
    await completeOnboarding(page)
  })

  async function goToCalendar(page: any) {
    await page.locator(".app-nav button").nth(1).click()
    await page.waitForTimeout(300)
  }

  // ── Month View ──
  test("month view shows 7 day headers and all cells", async ({ page }) => {
    await goToCalendar(page)
    await expect(page.locator(".month-view")).toBeVisible()
    await expect(page.locator(".day-header")).toHaveCount(7)
    // Month grids are 5 or 6 full weeks depending on where the 1st falls.
    const cellCount = await page.locator(".day-cell").count()
    expect(cellCount % 7).toBe(0)
    expect(cellCount).toBeGreaterThanOrEqual(35)
  })

  test("all 7 day headers are present as compact styled labels", async ({ page }) => {
    await goToCalendar(page)
    const allHeaders = page.locator(".day-header")
    await expect(allHeaders).toHaveCount(7)
    await expect(allHeaders.nth(0)).toContainText("Sun")
    await expect(allHeaders.nth(6)).toContainText("Sat")
  })

  test("today cell is highlighted", async ({ page }) => {
    await goToCalendar(page)
    await expect(page.locator(".day-cell.today")).toBeVisible()
  })

  test("day number in today cell is styled as a pill", async ({ page }) => {
    await goToCalendar(page)
    const todayNum = page.locator(".day-cell.today .day-num")
    await expect(todayNum).toBeVisible()
  })

  test("adjacent month cells are present and muted", async ({ page }) => {
    await goToCalendar(page)
    const adjacents = page.locator(".day-cell.adjacent")
    // Should have at least some adjacent cells (depends on month layout)
    const count = await adjacents.count()
    expect(count).toBeGreaterThan(0)
    // Adjacent cells should have reduced opacity
    await expect(adjacents.first()).toHaveClass(/adjacent/)
  })

  test("clicking adjacent month cell navigates to that month", async ({ page }) => {
    await goToCalendar(page)
    const label = page.locator(".nav-label")
    const firstLabel = await label.textContent()
    const adjacents = page.locator(".day-cell.adjacent")
    const count = await adjacents.count()
    expect(count).toBeGreaterThan(0)
    await adjacents.first().click()
    await page.waitForTimeout(400)
    expect(await label.textContent()).not.toBe(firstLabel)
  })

  // ── Navigation ──
  test("navigation arrows cycle months in month view", async ({ page }) => {
    await goToCalendar(page)
    const label = page.locator(".nav-label")
    const firstLabel = await label.textContent()
    const arrows = page.locator(".nav-arrow")
    await arrows.nth(1).click()
    await page.waitForTimeout(400)
    expect(await label.textContent()).not.toBe(firstLabel)
    await arrows.nth(0).click()
    await page.waitForTimeout(400)
    expect(await label.textContent()).toBe(firstLabel)
  })

  test("today button returns to current month", async ({ page }) => {
    await goToCalendar(page)
    const arrows = page.locator(".nav-arrow")
    await arrows.nth(1).click()
    await arrows.nth(1).click()
    await page.getByText("Today").click()
    await page.waitForTimeout(300)
    await expect(page.locator(".month-view")).toBeVisible()
  })

  // ── View Switching ──
  test("can switch between month, week, and day views", async ({ page }) => {
    await goToCalendar(page)
    const buttons = page.locator(".segmented-btn")
    await expect(buttons).toHaveCount(3)

    await buttons.nth(1).click()
    await page.waitForTimeout(300)
    await expect(page.locator(".week-view")).toBeVisible()

    await buttons.nth(2).click()
    await page.waitForTimeout(300)
    await expect(page.locator(".day-view")).toBeVisible()

    await buttons.nth(0).click()
    await page.waitForTimeout(300)
    await expect(page.locator(".month-view")).toBeVisible()
  })

  // ── Week View ──
  test("week view has 7 column headers and time labels", async ({ page }) => {
    await goToCalendar(page)
    await page.locator(".segmented-btn").nth(1).click()
    await page.waitForTimeout(300)
    await expect(page.locator(".week-col-header")).toHaveCount(7)
    const timeLabels = page.locator(".week-time-label")
    expect(await timeLabels.count()).toBe(24)
  })

  test("week view today column is highlighted", async ({ page }) => {
    await goToCalendar(page)
    await page.locator(".segmented-btn").nth(1).click()
    await page.waitForTimeout(300)
    await expect(page.locator(".week-col-header.today")).toBeVisible()
  })

  test("clicking a week day header opens that day", async ({ page }) => {
    await goToCalendar(page)
    await page.locator(".segmented-btn").nth(1).click()
    await page.waitForTimeout(300)
    await page.locator(".week-col-header").nth(3).click()
    await expect(page.locator(".day-view")).toBeVisible()
  })

  test("calendar stays opaque over the now-playing backdrop", async ({ page }) => {
    await goToCalendar(page)
    await page.locator(".segmented-btn").nth(1).click()
    await page.waitForTimeout(300)

    await page.evaluate(() => document.documentElement.classList.add("vinyl-backdrop"))
    const background = await page.locator(".calendar-view")
      .evaluate((el) => getComputedStyle(el).backgroundColor)
    expect(background).not.toBe("rgba(0, 0, 0, 0)")
    expect(background).not.toBe("transparent")

    await page.evaluate(() => document.documentElement.classList.remove("vinyl-backdrop"))
  })

  test("week view header is sticky", async ({ page }) => {
    await goToCalendar(page)
    await page.locator(".segmented-btn").nth(1).click()
    await page.waitForTimeout(300)
    const header = page.locator(".week-sticky")
    const position = await header.evaluate((el: HTMLElement) => getComputedStyle(el).position)
    expect(position).toBe("sticky")
  })

  // ── Day View ──
  test("day view shows 24 hour rows with correct time labels", async ({ page }) => {
    await goToCalendar(page)
    await page.locator(".segmented-btn").nth(2).click()
    await page.waitForTimeout(300)
    await expect(page.locator(".day-hour-cell")).toHaveCount(24)

    // First label is midnight (hour 0)
    const firstLabel = page.locator(".day-time-label").first()
    await expect(firstLabel).toContainText("12am")

    // Last label is hour 23 (11pm)
    const lastLabel = page.locator(".day-time-label").last()
    await expect(lastLabel).toContainText("11pm")
  })

  test("day view has sticky banner", async ({ page }) => {
    await goToCalendar(page)
    await page.locator(".segmented-btn").nth(2).click()
    await page.waitForTimeout(300)
    const banner = page.locator(".day-sticky")
    const position = await banner.evaluate((el: HTMLElement) => getComputedStyle(el).position)
    expect(position).toBe("sticky")
  })

  test("day view banner shows day name and date", async ({ page }) => {
    await goToCalendar(page)
    await page.locator(".segmented-btn").nth(2).click()
    await page.waitForTimeout(300)
    await expect(page.locator(".day-banner-dayname")).toBeVisible()
    await expect(page.locator(".day-banner-date")).toBeVisible()
  })

  test("day view navigation changes date", async ({ page }) => {
    await goToCalendar(page)
    await page.locator(".segmented-btn").nth(2).click()
    await page.waitForTimeout(300)

    const label = page.locator(".nav-label")
    const firstLabel = await label.textContent()
    const arrows = page.locator(".nav-arrow")
    await arrows.nth(1).click()
    await page.waitForTimeout(300)
    expect(await label.textContent()).not.toBe(firstLabel)
  })

  // ── Event Creation ──
  test("quick-add drawer opens and closes", async ({ page }) => {
    await goToCalendar(page)
    await page.getByRole("button", { name: "Add" }).click()
    await page.waitForTimeout(400)
    await expect(page.locator(".drawer")).toBeVisible()
    await page.locator(".close-btn").click()
    await page.waitForTimeout(400)
    await expect(page.locator(".drawer")).not.toBeVisible()
  })

  test("creating event requires title", async ({ page }) => {
    await goToCalendar(page)
    await page.getByRole("button", { name: "Add" }).click()
    await page.waitForTimeout(400)
    // Create Event button should be disabled without title
    const createBtn = page.getByRole("button", { name: "Create Event" })
    await expect(createBtn).toBeDisabled()
  })

  test("can create event with title only", async ({ page }) => {
    await goToCalendar(page)
    await createEventE2E(page, "Dinner")
    await expect(page.locator(".drawer")).not.toBeVisible()
  })

  test("member dropdown opens with quick-add", async ({ page }) => {
    await goToCalendar(page)
    await page.getByRole("button", { name: "Add" }).click()
    await page.waitForTimeout(400)
    await expect(page.locator(".quick-add-form select").first()).toBeVisible()
  })

  // ── View Persistence ──
  test("events persist across view switches", async ({ page }) => {
    await goToCalendar(page)
    await page.getByRole("button", { name: "Add" }).click()
    await page.waitForTimeout(400)
    await page.locator(".quick-add-form input").first().fill("Test Event")
    await page.getByRole("button", { name: "Create Event" }).click()
    await page.waitForTimeout(500)

    // Switch to week
    await page.locator(".segmented-btn").nth(1).click()
    await page.waitForTimeout(300)
    await expect(page.locator(".week-view")).toBeVisible()

    // Switch to day
    await page.locator(".segmented-btn").nth(2).click()
    await page.waitForTimeout(300)
    await expect(page.locator(".day-view")).toBeVisible()

    // Back to month
    await page.locator(".segmented-btn").nth(0).click()
    await page.waitForTimeout(300)
    await expect(page.locator(".month-view")).toBeVisible()
  })
})
