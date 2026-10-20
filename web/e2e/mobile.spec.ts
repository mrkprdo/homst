import { test, expect } from "@playwright/test"
import {
  setupApiMocks,
  setMockComplete,
  seedMockMembers,
  addMockAnnouncement,
  addMockEvent,
  addMockTask,
} from "./mocks"

/**
 * Mobile PWA shell. Mobile layout is chosen from the user agent, so we present
 * an iPhone UA and drive the touch-first interface.
 */
test.use({
  userAgent:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
})

/** An event on the selected day (today). The agenda shows past times too. */
function todayEvent(overrides: Record<string, unknown>) {
  const start = new Date()
  start.setHours(12, 0, 0, 0)
  const end = new Date(start)
  end.setHours(13)
  return { start_at: start.toISOString(), end_at: end.toISOString(), ...overrides }
}

test.describe("Mobile shell", () => {
  test.describe.configure({ mode: "serial" })

  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page)
    setMockComplete(true)
    // The holiday mock is dated today/tomorrow and useEvents folds holidays into
    // the event list — clear it so empty-state assertions are deterministic.
    await page.route("**/api/v1/holidays", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: "[]" }),
    )
    seedMockMembers([
      { id: "m1", name: "Alice", role: "admin", color: "sage-base" },
      { id: "m2", name: "Bob", color: "sky-base" },
    ])
    await page.goto("/")
    await page.locator(".mobile-shell").waitFor({ state: "visible" })
  })

  test("renders the mobile shell instead of the desktop navigation", async ({ page }) => {
    await expect(page.locator(".mobile-shell")).toBeVisible()
    await expect(page.locator(".app-nav")).toHaveCount(0)
    await expect(page.locator(".ms-tab", { hasText: "Events" })).toBeVisible()
    await expect(page.locator(".ms-tab", { hasText: "Tasks" })).toBeVisible()
    await expect(page.locator(".ms-fab")).toBeVisible()
    await expect(page.locator(".mc-week-strip .mc-day-btn")).toHaveCount(7)
  })

  test("events view shows an empty state with no events", async ({ page }) => {
    await expect(page.locator(".mc-state")).toContainText("Nothing scheduled")
    await expect(page.locator(".mc-agenda-date")).toContainText("Today")
  })

  test("tasks tab groups items by status", async ({ page }) => {
    addMockTask({ title: "Take out bins", status: "todo" })
    addMockTask({ title: "Plan dinner", status: "doing" })
    addMockTask({ title: "Water plants", status: "done" })
    await page.reload()
    await page.locator(".mobile-shell").waitFor({ state: "visible" })

    await page.locator(".ms-tab", { hasText: "Tasks" }).click()
    await expect(page.locator(".mt-section-header")).toHaveCount(3)
    await expect(page.locator(".mt-section-header").nth(0)).toHaveText(/To do/)
    await expect(page.locator(".mt-section-header").nth(1)).toHaveText(/In progress/)
    await expect(page.locator(".mt-section-header").nth(2)).toHaveText(/Done/)
  })

  test("tasks view hides empty sections and shows an empty state", async ({ page }) => {
    await page.locator(".ms-tab", { hasText: "Tasks" }).click()
    await expect(page.locator(".mt-state")).toContainText("No tasks yet")
    await expect(page.locator(".mt-section-header")).toHaveCount(0)
  })

  test("seeded events and tasks render in their views", async ({ page }) => {
    addMockEvent(todayEvent({ title: "Mobile standup" }))
    addMockTask({ title: "Take out bins", status: "todo" })
    await page.reload()
    await page.locator(".mobile-shell").waitFor({ state: "visible" })

    await expect(page.locator(".mc-event").filter({ hasText: "Mobile standup" })).toBeVisible()
    await page.locator(".ms-tab", { hasText: "Tasks" }).click()
    await expect(page.locator(".mt-item").filter({ hasText: "Take out bins" })).toBeVisible()
  })

  test("tapping an event opens the detail sheet", async ({ page }) => {
    addMockEvent(todayEvent({ title: "Tap me" }))
    await page.reload()
    await page.locator(".mobile-shell").waitFor({ state: "visible" })

    await page.locator(".mc-event").filter({ hasText: "Tap me" }).click()
    await expect(page.locator(".ms-detail-overlay")).toBeVisible()
    await expect(page.locator(".ms-detail-header")).toContainText("Event")

    await page.locator(".ms-detail-close").click()
    await expect(page.locator(".ms-detail-overlay")).not.toBeVisible()
  })

  test("week strip moves between days and back to today", async ({ page }) => {
    const day = page.locator(".mc-day-btn").nth(2)
    await day.click()
    await expect(day).toHaveAttribute("aria-pressed", "true")
    await expect(page.locator(".mc-day-btn[aria-pressed='true']")).toHaveCount(1)

    await page.locator(".mc-today-chip").click()
    await expect(page.locator(".mc-agenda-date")).toContainText("Today")
  })

  test("FAB opens quick-add and creates an event", async ({ page }) => {
    await page.locator(".ms-fab").click()
    await expect(page.locator(".mobile-quick-add")).toBeVisible()
    await expect(page.locator(".mqa-tab", { hasText: "Event" })).toBeVisible()
    await expect(page.locator(".mqa-tab", { hasText: "Task" })).toBeVisible()

    await page.locator(".mqa-input").first().fill("Created on mobile")
    await page.locator(".mqa-submit").click()
    await expect(page.locator(".mqa-toast")).toContainText("Created!")
  })

  test("profile button opens the mobile profile sheet", async ({ page }) => {
    await page.locator(".ms-profile-btn").click()
    await expect(page.locator(".mobile-profile")).toBeVisible()
    await expect(page.locator(".mp-name")).toContainText("Alice")
    await expect(page.locator(".mp-member-row")).toHaveCount(2)
    await expect(page.locator(".mp-member-name").nth(1)).toHaveText("Bob")

    await page.locator(".mp-close").click()
    await expect(page.locator(".mobile-profile")).not.toBeVisible()
  })

  test("a reminder notification deep-link opens the event sheet", async ({ page }) => {
    const ev = addMockEvent(
      todayEvent({ id: "ev-deeplink", title: "Deep linked event" }),
    )
    const startSeconds = Math.floor(new Date(String(ev.start_at)).getTime() / 1000)

    await page.goto(`/?event=${ev.id}&event_start=${startSeconds}`)
    await expect(page.locator(".ms-detail-overlay")).toBeVisible()
    await expect(page.locator(".ms-detail-overlay")).toContainText("Deep linked event")

    // The query is consumed so a reload does not reopen the sheet.
    expect(new URL(page.url()).search).toBe("")
  })

  test("an announcement notification deep-link opens the announcements sheet", async ({ page }) => {
    addMockAnnouncement({ id: "ann-deeplink", message: "Deep linked announcement" })

    await page.goto("/?announcement=ann-deeplink")
    await expect(page.locator(".ma-sheet")).toBeVisible()
    await expect(page.locator(".ma-sheet")).toContainText("Deep linked announcement")

    expect(new URL(page.url()).search).toBe("")
  })

  test("mobile onboarding gate blocks an unconfigured household", async ({ page }) => {
    setMockComplete(false)
    await page.reload()
    await expect(page.locator(".mobile-onboarding")).toBeVisible()
    await expect(page.locator(".onboarding-title")).toContainText("HOMST")
    await expect(page.locator(".mobile-shell")).toHaveCount(0)
  })
})
