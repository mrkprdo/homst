import { test, expect } from "@playwright/test"
import { setupApiMocks } from "./mocks"

test.describe("Onboarding", () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page)
    await page.goto("/onboarding")
  })

  // ── Step 1: House ──
  test("renders onboarding wizard with progress dots", async ({ page }) => {
    await expect(page.locator(".onboarding-overlay")).toBeVisible()
    await expect(page.locator(".progress-dot")).toHaveCount(4)
    await expect(page.locator(".step-title")).toContainText("Welcome")
  })

  test("Next button is disabled when house name is empty", async ({ page }) => {
    const btn = page.getByRole("button", { name: "Next" })
    await expect(btn).toBeDisabled()
  })

  test("Next button enables after entering house name", async ({ page }) => {
    await page.locator("input").first().fill("Smith Family")
    await expect(page.getByRole("button", { name: "Next" })).toBeEnabled()
  })

  test("can fill house name and optionally address then proceed", async ({ page }) => {
    await page.locator("input").first().fill("My House")
    await page.locator("input").nth(1).fill("123 Main St")
    await page.getByRole("button", { name: "Next" }).click()
    await expect(page.locator(".step-title")).toContainText("Members")
  })

  // ── Step 2: Members ──
  test("Back button returns to house step", async ({ page }) => {
    await page.locator("input").first().fill("Home")
    await page.getByRole("button", { name: "Next" }).click()
    await expect(page.getByRole("button", { name: "Back" })).toBeVisible()
    await page.getByRole("button", { name: "Back" }).click()
    await expect(page.locator(".step-title")).toContainText("Welcome")
  })

  test("starts with one empty member", async ({ page }) => {
    await page.locator("input").first().fill("Home")
    await page.getByRole("button", { name: "Next" }).click()
    await expect(page.locator(".member-row")).toHaveCount(1)
  })

  test("can add up to 5 members", async ({ page }) => {
    await page.locator("input").first().fill("Home")
    await page.getByRole("button", { name: "Next" }).click()
    for (let i = 0; i < 4; i++) {
      await page.getByRole("button", { name: "Add member" }).click()
    }
    await expect(page.locator(".member-row")).toHaveCount(5)
  })

  test("cannot remove last member", async ({ page }) => {
    await page.locator("input").first().fill("Home")
    await page.getByRole("button", { name: "Next" }).click()
    // The remove button should not be visible when only 1 member
    await expect(page.locator(".member-remove")).not.toBeVisible()
  })

  test("can remove added member", async ({ page }) => {
    await page.locator("input").first().fill("Home")
    await page.getByRole("button", { name: "Next" }).click()
    await page.getByRole("button", { name: "Add member" }).click()
    await expect(page.locator(".member-row")).toHaveCount(2)
    await page.locator(".member-remove").last().click()
    await expect(page.locator(".member-row")).toHaveCount(1)
  })

  test("Next is disabled when any member name is empty", async ({ page }) => {
    await page.locator("input").first().fill("Home")
    await page.getByRole("button", { name: "Next" }).click()
    await expect(page.getByRole("button", { name: "Next" })).toBeDisabled()
  })

  test("Next enables when all members have names", async ({ page }) => {
    await page.locator("input").first().fill("Home")
    await page.getByRole("button", { name: "Next" }).click()
    await page.locator(".member-input").first().fill("Alice")
    await expect(page.getByRole("button", { name: "Next" })).toBeEnabled()
  })

  // ── Step 3: Holidays ──
  test("holiday step shows country selector and province field", async ({ page }) => {
    await page.locator("input").first().fill("Home")
    await page.getByRole("button", { name: "Next" }).click()
    await page.locator(".member-input").first().fill("Alice")
    await page.getByRole("button", { name: "Next" }).click()
    await expect(page.locator(".step-title")).toContainText("Holiday")
    await expect(page.locator("select")).toBeVisible()
  })

  // ── Step 4: Review ──
  test("review shows all entered values", async ({ page }) => {
    await page.locator("input").first().fill("Our Home")
    await page.getByRole("button", { name: "Next" }).click()
    await page.locator(".member-input").nth(0).fill("Alice")
    await page.getByRole("button", { name: "Add member" }).click()
    await page.locator(".member-input").nth(1).fill("Bob")
    await page.getByRole("button", { name: "Next" }).click()
    await page.getByRole("button", { name: "Next" }).click()

    await expect(page.locator(".review-value").nth(0)).toContainText("Our Home")
    await expect(page.locator(".review-value").nth(1)).toContainText("Alice, Bob")
  })

  test("confirm redirects to home page", async ({ page }) => {
    await page.locator("input").first().fill("Test")
    await page.getByRole("button", { name: "Next" }).click()
    await page.locator(".member-input").first().fill("Me")
    await page.getByRole("button", { name: "Next" }).click()
    await page.getByRole("button", { name: "Next" }).click()
    await page.getByRole("button", { name: "Confirm" }).click()
    await expect(page.locator(".app-nav")).toBeVisible()
  })

  test("onboarding guard redirects / to /onboarding when incomplete", async ({ page }) => {
    await page.goto("/")
    await expect(page.locator(".onboarding-overlay")).toBeVisible()
  })
})
