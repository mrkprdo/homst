import { test, expect } from "@playwright/test"
import { setupApiMocks } from "./mocks"

test.describe("Profile & Events", () => {
  test.describe.configure({ mode: "serial" })
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page)
    await page.goto("/onboarding")
    await page.locator("input").first().fill("Smith Family")
    await page.getByRole("button", { name: "Next" }).click()

    const members = ["Alice", "Bob", "Carol"]
    for (let i = 0; i < members.length; i++) {
      if (i > 0) await page.getByRole("button", { name: "Add member" }).click()
      await page.locator(".member-input").nth(i).fill(members[i]!)
    }
    await page.getByRole("button", { name: "Next" }).click()
    await page.getByRole("button", { name: "Next" }).click()
    await page.getByRole("button", { name: "Confirm" }).click()
    await page.waitForTimeout(500)
  })

  // ── Profile Drawer ──
  test("profile drawer opens and shows house name", async ({ page }) => {
    await page.locator(".nav-item--profile").click()
    await page.waitForTimeout(500)
    await expect(page.locator(".drawer")).toBeVisible()
    await expect(page.locator(".member-detail")).toBeVisible()
    await expect(page.locator(".md-value--large")).toContainText("Smith Family")
  })

  test("profile shows members from API", async ({ page }) => {
    await page.locator(".nav-item--profile").click()
    await page.waitForTimeout(500)
    await expect(page.locator(".md-member-row").first()).toBeVisible()
  })

  test("profile shows onboarding member names", async ({ page }) => {
    await page.locator(".nav-item--profile").click()
    await page.waitForTimeout(500)
    // Members from mock API: Alice, Bob, Carol
    const inputs = page.locator(".md-member-row input")
    await expect(inputs).toHaveCount(3)
    await expect(inputs.nth(0)).toHaveValue("Alice")
    await expect(inputs.nth(1)).toHaveValue("Bob")
    await expect(inputs.nth(2)).toHaveValue("Carol")
  })

  test("profile shows house name after reload", async ({ page }) => {
    await page.reload()
    await page.waitForTimeout(500)
    await page.locator(".nav-item--profile").click()
    await page.waitForTimeout(500)
    await expect(page.locator(".md-value--large")).toContainText("Smith Family")
  })

  test("profile shows members after reload", async ({ page }) => {
    await page.reload()
    await page.waitForTimeout(500)
    await page.locator(".nav-item--profile").click()
    await page.waitForTimeout(500)
    const inputs = page.locator(".md-member-row input")
    await expect(inputs.nth(0)).toHaveValue("Alice")
    await expect(inputs.nth(1)).toHaveValue("Bob")
  })

  test("not redirected to onboarding after reload when complete", async ({ page }) => {
    await page.reload()
    await page.waitForTimeout(500)
    await expect(page.locator(".onboarding-overlay")).not.toBeVisible()
    await expect(page.locator(".app-nav")).toBeVisible()
  })

  test("edit house name persists after reload", async ({ page }) => {
    await page.locator(".nav-item--profile").click()
    await page.waitForTimeout(500)
    await page.locator(".md-edit").first().click()
    await page.waitForTimeout(200)
    const input = page.locator(".md-input").first()
    await input.fill("Reloaded Home")
    await page.getByRole("button", { name: "Save" }).click()
    await expect(page.locator(".md-value--large")).toContainText("Reloaded Home")

    // Persist all changes via Save Changes
    await page.locator(".md-save-btn").click()
    await page.locator(".md-confirm-panel").getByRole("button", { name: "Save" }).click()
    await page.waitForTimeout(500)
    await expect(page.locator(".md-confirm")).toContainText("Changes saved")
    await page.locator(".close-btn").click()
    await page.waitForTimeout(400)

    await page.reload()
    await page.waitForTimeout(500)
    await page.locator(".nav-item--profile").click()
    await page.waitForTimeout(500)
    await expect(page.locator(".md-value--large")).toContainText("Reloaded Home")
  })

  test("address persists after reload", async ({ page }) => {
    await page.locator(".nav-item--profile").click()
    await page.waitForTimeout(500)
    await page.getByText("+ Add address").click()
    await page.waitForTimeout(200)
    const addrInput = page.locator(".md-input").first()
    await addrInput.fill("789 Pine St")
    await page.getByRole("button", { name: "Save" }).click()
    await expect(page.locator(".md-value").nth(1)).toContainText("789 Pine St")

    // Persist all changes via Save Changes
    await page.locator(".md-save-btn").click()
    await page.locator(".md-confirm-panel").getByRole("button", { name: "Save" }).click()
    await page.waitForTimeout(500)
    await expect(page.locator(".md-confirm")).toContainText("Changes saved")
    await page.locator(".close-btn").click()
    await page.waitForTimeout(400)

    await page.reload()
    await page.waitForTimeout(500)
    await page.locator(".nav-item--profile").click()
    await page.waitForTimeout(500)
    await expect(page.locator(".md-value").nth(1)).toContainText("789 Pine St")
  })

  test("can edit house name inline", async ({ page }) => {
    await page.locator(".nav-item--profile").click()
    await page.waitForTimeout(500)

    await page.locator(".md-edit").first().click()
    await page.waitForTimeout(200)

    const input = page.locator(".md-input").first()
    await input.fill("New House Name")
    await page.getByRole("button", { name: "Save" }).click()

    await expect(page.locator(".md-value--large")).toContainText("New House Name")
  })

  test("can add address inline", async ({ page }) => {
    await page.locator(".nav-item--profile").click()
    await page.waitForTimeout(500)

    await page.getByText("+ Add address").click()
    await page.waitForTimeout(200)

    const addrInput = page.locator(".md-input").first()
    await addrInput.fill("456 Oak Ave")
    await page.getByRole("button", { name: "Save" }).click()

    await expect(page.locator(".md-value").nth(1)).toContainText("456 Oak Ave")
  })

  // ── Save Changes Button ──

  test("Save Changes button appears when house name edited", async ({ page }) => {
    await page.locator(".nav-item--profile").click()
    await page.waitForTimeout(500)
    await expect(page.locator(".md-save-btn")).not.toBeVisible()
    await page.locator(".md-edit").first().click()
    await page.waitForTimeout(200)
    await page.locator(".md-input").first().fill("Edited Name")
    await page.getByRole("button", { name: "Save" }).click()
    await expect(page.locator(".md-save-btn")).toBeVisible()
  })

  test("Save Changes button persists member name change", async ({ page }) => {
    await page.locator(".nav-item--profile").click()
    await page.waitForTimeout(500)
    const memberInput = page.locator(".md-member-row").first().locator("input")
    await memberInput.fill("Alice Edited")
    await page.locator(".md-save-btn").click()
    await page.locator(".md-confirm-panel").getByRole("button", { name: "Save" }).click()
    await page.waitForTimeout(500)
    await expect(page.locator(".md-confirm")).toContainText("Changes saved")
    await page.locator(".close-btn").click()
    await page.waitForTimeout(400)

    await page.reload()
    await page.waitForTimeout(500)
    await page.locator(".nav-item--profile").click()
    await page.waitForTimeout(500)
    const reloadedInput = page.locator(".md-member-row").first().locator("input")
    await expect(reloadedInput).toHaveValue("Alice Edited")
  })

  test("Save Changes button persists new member", async ({ page }) => {
    await page.locator(".nav-item--profile").click()
    await page.waitForTimeout(500)
    // Add new member (makes 4th)
    const addBtns = page.locator(".md-add-link")
    const addMemberBtn = addBtns.filter({ hasText: "Add member" })
    await addMemberBtn.click()
    await page.waitForTimeout(200)
    const newInput = page.locator(".md-member-row").last().locator("input")
    await newInput.fill("Diana")
    await page.locator(".md-save-btn").click()
    await page.locator(".md-confirm-panel").getByRole("button", { name: "Save" }).click()
    await page.waitForTimeout(500)
    await expect(page.locator(".md-confirm")).toContainText("Changes saved")
    await page.locator(".close-btn").click()
    await page.waitForTimeout(400)

    await page.reload()
    await page.waitForTimeout(500)
    await page.locator(".nav-item--profile").click()
    await page.waitForTimeout(500)
    await expect(page.locator(".md-member-row")).toHaveCount(4)
  })

  test("Save Changes shows confirmation after saving", async ({ page }) => {
    await page.locator(".nav-item--profile").click()
    await page.waitForTimeout(500)
    await page.locator(".md-edit").first().click()
    await page.waitForTimeout(200)
    await page.locator(".md-input").first().fill("Confirm Test")
    await page.getByRole("button", { name: "Save" }).click()
    await page.locator(".md-save-btn").click()
    await page.locator(".md-confirm-panel").getByRole("button", { name: "Save" }).click()
    await page.waitForTimeout(500)
    await expect(page.locator(".md-confirm")).toBeVisible()
    await expect(page.locator(".md-confirm")).toContainText("Changes saved")
  })

  test("Save Changes disabled when no changes", async ({ page }) => {
    await page.locator(".nav-item--profile").click()
    await page.waitForTimeout(500)
    await expect(page.locator(".md-save-btn")).not.toBeVisible()
  })

  test("can change member color", async ({ page }) => {
    await page.locator(".nav-item--profile").click()
    await page.waitForTimeout(500)

    // Hover over first member's color button to show popover
    const colorBtn = page.locator(".member-color-btn").first()
    await colorBtn.hover()
    await page.waitForTimeout(200)

    // Click a different color (scope to first member's popover)
    const firstRow = page.locator(".md-member-row").first()
    const colorOpts = firstRow.locator(".color-opt")
    await expect(colorOpts).toHaveCount(25)
    await colorOpts.nth(10).click()
  })

  test("can close and reopen profile drawer", async ({ page }) => {
    await page.locator(".nav-item--profile").click()
    await page.waitForTimeout(500)
    await expect(page.locator(".drawer")).toBeVisible()

    // Close
    await page.locator(".close-btn").click()
    await page.waitForTimeout(400)
    await expect(page.locator(".drawer")).not.toBeVisible()

    // Reopen
    await page.locator(".nav-item--profile").click()
    await page.waitForTimeout(500)
    await expect(page.locator(".member-detail")).toBeVisible()
  })

  // ── Events with Members ──
  async function goToCalendar(page: any) {
    await page.locator(".app-nav button").nth(1).click()
    await page.waitForTimeout(300)
  }

  test("member select shows in quick-add", async ({ page }) => {
    await goToCalendar(page)
    await page.getByRole("button", { name: "Add" }).click()
    await page.waitForTimeout(400)
    await expect(page.locator(".quick-add-form select").first()).toBeVisible()
  })

  test("can create events assigned to different members", async ({ page }) => {
    await goToCalendar(page)

    for (let i = 1; i <= 3; i++) {
      await page.getByRole("button", { name: "Add" }).click()
      await page.waitForTimeout(400)
      await page.locator(".quick-add-form input").first().fill(`Event ${i}`)
      await page.locator(".quick-add-form select").nth(1).selectOption({ index: i })
      await page.getByRole("button", { name: "Create Event" }).click()
      await page.waitForTimeout(400)
    }

    // All created successfully, drawer closed
    await expect(page.locator(".drawer")).not.toBeVisible()
  })

  test("can view events in day view after creation", async ({ page }) => {
    await goToCalendar(page)

    await page.getByRole("button", { name: "Add" }).click()
    await page.waitForTimeout(400)
    await page.locator(".quick-add-form input").first().fill("Lunch")
    await page.getByRole("button", { name: "Create Event" }).click()
    await page.waitForTimeout(500)

    await page.locator(".segmented-btn").nth(2).click()
    await page.waitForTimeout(300)
    await expect(page.locator(".day-view")).toBeVisible()
    await expect(page.locator(".day-hour-cell")).toHaveCount(24)
  })
})
