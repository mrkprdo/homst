import { test, expect } from "@playwright/test"
import { setupApiMocks, completeOnboarding, createTaskE2E } from "./mocks"

test.describe("Tasks", () => {
  test.describe.configure({ mode: "serial" })
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page)
    await completeOnboarding(page)
  })

  async function goToTasks(page: any) {
    await page.locator(".app-nav button").nth(2).click()
    await page.waitForTimeout(500)
  }

  async function goToKanban(page: any) {
    await page.locator(".app-nav button").nth(2).click()
    await page.waitForTimeout(500)
  }

  // ── Task View ──

  test("task view renders with title", async ({ page }) => {
    await goToTasks(page)
    await expect(page.locator(".tasks-view")).toBeVisible()
    await expect(page.locator(".page-header")).toBeVisible()
  })

  test("create task via quick-add appears in task view", async ({ page }) => {
    await goToTasks(page)
    await createTaskE2E(page, "Buy groceries")
    await expect(page.locator(".drawer")).not.toBeVisible()
    await expect(page.locator(".task-card")).toHaveCount(1)
    await expect(page.locator(".task-card__title")).toContainText("Buy groceries")
  })

  test("create multiple tasks shows all in list", async ({ page }) => {
    await goToTasks(page)
    for (const title of ["Task A", "Task B", "Task C"]) {
      await createTaskE2E(page, title)
    }
    await expect(page.locator(".task-card")).toHaveCount(3)
  })

  test("task shows priority badge", async ({ page }) => {
    await goToTasks(page)
    await page.getByRole("button", { name: "Add" }).click()
    await page.waitForTimeout(400)
    await page.locator(".quick-add-form input").first().fill("High Priority Task")
    await page.locator(".priority-btn.priority--high").click()
    await page.waitForTimeout(200)
    await page.getByRole("button", { name: "Create Task" }).click()
    await page.waitForTimeout(600)
    await expect(page.locator(".priority--high")).toBeVisible()
  })

  test("task with due date shows due badge", async ({ page }) => {
    await goToTasks(page)
    await page.getByRole("button", { name: "Add" }).click()
    await page.waitForTimeout(400)
    await page.locator(".quick-add-form input").first().fill("Dated Task")
    const dateInput = page.locator(".quick-add-form input[type='date']").first()
    if (await dateInput.isVisible()) {
      await dateInput.fill("2026-06-01")
    }
    await page.getByRole("button", { name: "Create Task" }).click()
    await page.waitForTimeout(600)
    await expect(page.locator(".task-card__due")).toBeVisible()
  })

  test("task view switches to kanban and back", async ({ page }) => {
    await goToTasks(page)
    await expect(page.locator(".tasks-view")).toBeVisible()
    await goToKanban(page)
    await expect(page.locator(".tasks-view")).toBeVisible()
    await goToTasks(page)
    await expect(page.locator(".tasks-view")).toBeVisible()
  })

  // ── Kanban View ──

  test("kanban view shows 3 columns", async ({ page }) => {
    await goToKanban(page)
    await expect(page.locator(".tasks-view")).toBeVisible()
    await expect(page.locator(".tasks-column")).toHaveCount(3)
  })

  test("kanban columns have correct headers", async ({ page }) => {
    await goToKanban(page)
    const headers = page.locator(".column-title")
    await expect(headers).toHaveCount(3)
    await expect(headers.nth(0)).toContainText("To Do")
    await expect(headers.nth(1)).toContainText("Doing")
    await expect(headers.nth(2)).toContainText("Done")
  })

  test("task created in task view appears in kanban To Do", async ({ page }) => {
    await goToTasks(page)
    await createTaskE2E(page, "Kanban Task")
    await goToKanban(page)
    const todoCards = page.locator(".tasks-column").nth(0).locator(".task-card")
    await expect(todoCards).toHaveCount(1)
    await expect(todoCards.locator(".task-card__title")).toContainText("Kanban Task")
  })

  test("kanban shows empty columns when no tasks", async ({ page }) => {
    await goToKanban(page)
    const allCards = page.locator(".tasks-column .task-card")
    await expect(allCards).toHaveCount(0)
  })
})
