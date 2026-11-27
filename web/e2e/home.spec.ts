import { test, expect } from "@playwright/test"
import { setupApiMocks, completeOnboarding, addMockEvent, addMockTask } from "./mocks"

test.describe("Home dashboard", () => {
  test.describe.configure({ mode: "serial" })

  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page)
    await page.route("**/api/v1/holidays", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: "[]" }),
    )
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
    await page.setViewportSize({ width: 1920, height: 1080 })
    await expect(page.locator(".home-view")).toBeVisible()
    await expect(page.locator(".widget")).toHaveCount(9)

    await expect(page.locator(".datetime-house")).toContainText("Cedar House")
    await expect(page.locator(".datetime-date")).toBeVisible()
    await expect(page.locator(".datetime-time")).toBeVisible()

    for (const title of ["Today's Schedule", "Weather", "To Do", "Photos", "Spotify"]) {
      await expect(page.locator(".widget").filter({ hasText: title }).first()).toBeVisible()
    }
    const monthName = new Date().toLocaleString("en-US", { month: "long", year: "numeric" })
    await expect(page.locator(".widget").filter({ hasText: monthName })).toBeVisible()
    await expect(page.locator(".mini-cal-day")).not.toHaveCount(0)
  })

  test("home canvas leaves room for the card ink lip", async ({ page }) => {
    const style = await page.locator(".home-view").evaluate((el) => {
      const s = getComputedStyle(el)
      return { overflow: s.overflow, margin: Number.parseFloat(s.overflowClipMargin) || 0 }
    })
    expect(style.overflow).toBe("clip")
    expect(style.margin).toBeGreaterThanOrEqual(3)
  })

  test("tall weather cards centre the scene instead of anchoring it to the top", async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 })
    await page.route("https://geocoding-api.open-meteo.com/**", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ results: [] }) }),
    )
    await page.route("https://api.open-meteo.com/**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          current: { temperature_2m: 21.4, apparent_temperature: 20.1, weather_code: 3, is_day: 1, relative_humidity_2m: 55, wind_speed_10m: 12.3 },
          daily: { temperature_2m_max: [25.2], temperature_2m_min: [14.8], weather_code: [3] },
        }),
      }),
    )

    await page.evaluate(() => {
      localStorage.setItem("homst-widget-layout", JSON.stringify([
        { id: "weather", col: 0, row: 0, w: 1, h: 4 },
        { id: "datetime", col: 1, row: 0, w: 1, h: 1 },
      ]))
      localStorage.setItem("homst:weather-coords", JSON.stringify({ lat: 43.65, lon: -79.38 }))
    })
    await page.reload()

    const weather = page.locator(".widget").filter({ hasText: "Weather" }).first()
    await expect(weather.locator(".weather-temp")).toBeVisible()

    const cloudOffset = await weather.evaluate((el) => {
      const card = el.getBoundingClientRect()
      const cloud = el.querySelector(".wx-cloud--a")!.getBoundingClientRect()
      return (cloud.top - card.top) / card.height
    })
    expect(cloudOffset).toBeGreaterThan(0.25)
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
    const start = new Date()
    start.setHours(12, 0, 0, 0)
    const end = new Date(start)
    end.setHours(13)
    addMockEvent({ title: "Team standup", start_at: start.toISOString(), end_at: end.toISOString() })
    await page.reload()
    await page.waitForTimeout(700)
    await expect(page.locator(".widget").filter({ hasText: "Today's Schedule" })).toContainText("Team standup")
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
    await expect(page.locator(".grid-cell-bg")).toHaveCount(36)
    await expect(page.locator(".drag-handle")).toHaveCount(9)
    await expect(page.locator(".resize-handle")).toHaveCount(9)

    await toggle.click()
    await expect(page.locator(".widget-canvas")).not.toHaveClass(/is-editing/)
    await expect(page.locator(".grid-cell-bg")).toHaveCount(0)
  })

  test("double-clicking a card expands it into a blow-up view", async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 })
    const house = page.locator(".widget").filter({ hasText: "Cedar House" }).first()

    await house.locator(".home-block").dblclick()

    const stage = page.locator(".card-blowup__stage")
    await expect(stage).toBeVisible()
    await expect(stage.locator(".widget")).toHaveCount(1)
    await expect(stage.locator(".datetime-house")).toHaveText("Cedar House")
    await expect(page.locator(".widget-canvas .widget")).toHaveCount(8)

    const box = await stage.boundingBox()
    expect(box!.width).toBeGreaterThan(1000)

    await page.locator(".card-blowup__close").click()
    await expect(page.locator(".card-blowup")).toHaveCount(0)
    await expect(page.locator(".widget-canvas .widget")).toHaveCount(9)
  })

  test("card surfaces do not allow text selection", async ({ page }) => {
    const card = page.locator(".widget").first()
    expect(await card.evaluate(el => getComputedStyle(el).userSelect)).toBe("none")

    const input = page.locator(".spotify-setup-input")
    await expect(input).toBeVisible()
    expect(await input.evaluate(el => getComputedStyle(el).userSelect)).toBe("text")
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
