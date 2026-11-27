import { test, expect } from "@playwright/test"
import { setupApiMocks, addMockEvent, completeOnboarding, setMockNotifications, openManualEventQuickAdd } from "./mocks"

test.describe("Events", () => {
  test.describe.configure({ mode: "serial" })
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page)
    await page.goto("/onboarding")
    await page.locator("input").first().fill("Test Home")
    await page.getByRole("button", { name: "Next" }).click()
    await page.locator(".member-input").first().fill("Alice")
    await page.getByRole("button", { name: "Next" }).click()
    await page.getByRole("button", { name: "Next" }).click()
    await page.getByRole("button", { name: "Confirm" }).click()
    await page.waitForTimeout(500)
  })

  async function goToCalendar(page: any) {
    await page.locator(".app-nav button").nth(1).click()
    await page.waitForTimeout(600)
  }

  async function createEvent(page: any, title: string, extra?: () => Promise<void>) {
    await openManualEventQuickAdd(page)
    await page.locator(".quick-add-form input").first().fill(title)
    if (extra) await extra()
    await page.getByRole("button", { name: "Create Event" }).click()
    await page.waitForTimeout(500)
  }

  test("create event via quick-add closes drawer", async ({ page }) => {
    await goToCalendar(page)
    await createEvent(page, "New Event")
    await expect(page.locator(".drawer")).not.toBeVisible()
  })

  test("create event with assignee", async ({ page }) => {
    await goToCalendar(page)
    await createEvent(page, "Assigned Event", async () => {
      await page.locator(".quick-add-form select").nth(1).selectOption({ index: 1 })
    })
    await expect(page.locator(".drawer")).not.toBeVisible()
  })

  test("create event with a reminder sends reminder_minutes", async ({ page }) => {
    await goToCalendar(page)
    const requestPromise = page.waitForRequest(
      (r) => r.url().includes("/api/v1/events") && r.method() === "POST",
    )
    await createEvent(page, "Reminder Event", async () => {
      await page.locator(".ui-field").filter({ hasText: "Remind me" }).locator("select").selectOption("30")
    })
    const payload = JSON.parse((await requestPromise).postData() || "{}")
    expect(payload.reminder_minutes).toBe(30)
  })

  test("create all-day event", async ({ page }) => {
    await goToCalendar(page)
    await openManualEventQuickAdd(page)
    await page.locator(".quick-add-form input").first().fill("All Day Event")
    await page.locator(".field-row").filter({ hasText: "All day" }).locator("button").first().click()
    await page.waitForTimeout(200)
    await page.getByRole("button", { name: "Create Event" }).click()
    await page.waitForTimeout(500)
    await expect(page.locator(".drawer")).not.toBeVisible()
  })

  test("create event with description", async ({ page }) => {
    await goToCalendar(page)
    await openManualEventQuickAdd(page)
    await page.locator(".quick-add-form input").first().fill("Described Event")
    const textareas = page.locator(".quick-add-form textarea")
    if (await textareas.count() > 0) {
      await textareas.first().fill("This is a description")
    }
    await page.getByRole("button", { name: "Create Event" }).click()
    await page.waitForTimeout(500)
    await expect(page.locator(".drawer")).not.toBeVisible()
  })

  async function scrollDayToTop(page: any) {
    await page.evaluate(() => {
      const el = document.querySelector(".day-view") as HTMLElement
      if (el) el.scrollTop = 0
    })
    await page.waitForTimeout(300)
  }

})

test.describe("Event Detail & Edit", () => {
  test.describe.configure({ mode: "serial" })

  const CHIP_TITLE = "Editable Test Event"

  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page)
    addMockEvent({ id: "ev-edit-test", title: CHIP_TITLE, reminder_minutes: 30 })
    await page.goto("/onboarding")
    await page.locator("input").first().fill("Test Home")
    await page.getByRole("button", { name: "Next" }).click()
    await page.locator(".member-input").first().fill("Alice")
    await page.getByRole("button", { name: "Next" }).click()
    await page.getByRole("button", { name: "Next" }).click()
    await page.getByRole("button", { name: "Confirm" }).click()
    await page.waitForTimeout(500)
    await page.locator(".app-nav button").nth(1).click()
    await page.waitForTimeout(800)
  })

  async function openChip(page: any) {
    await page.locator(".event-chip").filter({ hasText: CHIP_TITLE }).click()
    await page.waitForTimeout(400)
  }

  test("event detail drawer opens on chip click", async ({ page }) => {
    await openChip(page)
    await expect(page.locator(".drawer")).toBeVisible()
    await expect(page.locator(".edp-title")).toContainText(CHIP_TITLE)
    await expect(page.getByRole("button", { name: "Edit", exact: true })).toBeVisible()
  })

  test("Escape closes the event drawer and returns focus to the chip", async ({ page }) => {
    await openChip(page)
    await expect(page.locator(".drawer")).toBeVisible()

    await page.keyboard.press("Escape")
    await expect(page.locator(".drawer")).toHaveCount(0, { timeout: 2000 })
    await expect(page.locator(".event-chip").filter({ hasText: CHIP_TITLE })).toBeFocused()
  })

  test("event detail shows the reminder", async ({ page }) => {
    await openChip(page)
    await expect(page.locator(".edp-fields")).toContainText("Reminder 30 minutes before")
  })

  test("event edit form has assignee select matching create form", async ({ page }) => {
    await openChip(page)
    await page.getByRole("button", { name: "Edit", exact: true }).click()
    await page.waitForTimeout(200)
    await expect(page.locator(".edp-form .ui-input").first()).toHaveValue(CHIP_TITLE)
    await expect(page.locator(".edp-form .ui-select").first()).toBeVisible()
    await expect(page.locator(".edp-form .ui-select").first()).toContainText("No one")
    await expect(page.locator(".edp-form .ui-select").first()).toContainText("Alice")
  })

  test("event edit saves updated title", async ({ page }) => {
    await openChip(page)
    await page.getByRole("button", { name: "Edit", exact: true }).click()
    await page.waitForTimeout(200)
    const titleInput = page.locator(".edp-form .ui-input").first()
    await titleInput.clear()
    await titleInput.fill("Updated Title")
    await page.getByRole("button", { name: "Save" }).click()
    await page.waitForTimeout(500)
    await expect(page.locator(".edp-title")).toContainText("Updated Title")
  })

  test("event edit saves assignee and shows member name in view", async ({ page }) => {
    await openChip(page)
    await page.getByRole("button", { name: "Edit", exact: true }).click()
    await page.waitForTimeout(200)
    await page.locator(".edp-form .ui-select").first().selectOption({ index: 1 })
    await page.getByRole("button", { name: "Save" }).click()
    await page.waitForTimeout(500)
    await expect(page.locator(".edp")).toContainText("Alice")
  })

  test("event edit cancel returns to view without saving", async ({ page }) => {
    await openChip(page)
    await page.getByRole("button", { name: "Edit", exact: true }).click()
    await page.waitForTimeout(200)
    const titleInput = page.locator(".edp-form .ui-input").first()
    await titleInput.clear()
    await titleInput.fill("Should Not Save")
    await page.getByRole("button", { name: "Cancel" }).click()
    await page.waitForTimeout(300)
    await expect(page.locator(".edp-title")).toContainText(CHIP_TITLE)
  })

  test("event edit PATCH request includes assignee_id", async ({ page }) => {
    await openChip(page)
    await page.getByRole("button", { name: "Edit", exact: true }).click()
    await page.waitForTimeout(200)
    await page.locator(".edp-form .ui-select").first().selectOption({ index: 1 })
    const patchPromise = page.waitForRequest(
      (req: any) => req.method() === "PATCH" && req.url().includes("/events/")
    )
    await page.getByRole("button", { name: "Save" }).click()
    const req = await patchPromise
    const body = JSON.parse(req.postData() ?? "{}")
    expect(body).toHaveProperty("assignee_id")
    expect(body.assignee_id).not.toBeNull()
  })
})

test.describe("Reminder defaults", () => {
  test("new events prefill the household default reminder", async ({ page }) => {
    await setupApiMocks(page)
    setMockNotifications({ defaultReminderMinutes: 30 })
    await completeOnboarding(page)

    await page.locator(".app-nav button").nth(1).click()
    await page.waitForTimeout(600)
    await openManualEventQuickAdd(page)

    const select = page.locator(".ui-field").filter({ hasText: "Remind me" }).locator("select")
    await expect(select).toHaveValue("30")
  })
})
