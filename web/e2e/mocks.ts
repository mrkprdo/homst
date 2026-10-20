import type { Page, Locator } from "@playwright/test"

let mockComplete = false
let mockHouseName = ""
let mockAddress = ""
let mockNotifications: Record<string, unknown> = { hud: true, defaultReminderMinutes: null }

const mockMembers: Record<string, unknown>[] = []

const mockCalendars: Record<string, unknown>[] = []
const mockEvents: Record<string, unknown>[] = []
const mockAnnouncements: Record<string, unknown>[] = []
const mockTasks: Record<string, unknown>[] = []
const mockTaskLists: Record<string, unknown>[] = [
  { id: "tl-mock", household_id: "hh-mock", name: "General", color: "taupe", position: 0 },
]

const mockHolidays: Record<string, unknown>[] = [
  { id: "hol-1", household_id: "hh-mock", date: new Date().toISOString().slice(0, 10), name: "Today Holiday", local_name: "Today Holiday", country_code: "US", province: null, created_at: new Date().toISOString() },
]

export async function completeOnboarding(page: Page, houseName = "Test Home") {
  await page.goto("/onboarding")
  await page.locator("input").first().fill(houseName)
  await page.getByRole("button", { name: "Next" }).click()
  await page.locator(".member-input").first().fill("Alice")
  await page.getByRole("button", { name: "Next" }).click()
  await page.getByRole("button", { name: "Next" }).click()
  await page.getByRole("button", { name: "Confirm" }).click()
  await page.waitForTimeout(500)
}

export async function createTaskE2E(page: Page, title: string, extra?: () => Promise<void>) {
  await page.getByRole("button", { name: "Add" }).click()
  await page.waitForTimeout(400)
  await page.locator(".quick-add-form input").first().fill(title)
  if (extra) await extra()
  await page.getByRole("button", { name: "Create Task" }).click()
  await page.waitForTimeout(600)
}

export async function createEventE2E(page: Page, title: string, extra?: () => Promise<void>) {
  await page.getByRole("button", { name: "Add" }).click()
  await page.waitForTimeout(400)
  await page.locator(".quick-add-form input").first().fill(title)
  if (extra) await extra()
  await page.getByRole("button", { name: "Create Event" }).click()
  await page.waitForTimeout(500)
}

export function resetMockState() {
  mockComplete = false
  mockHouseName = ""
  mockAddress = ""
  mockNotifications = { hud: true, defaultReminderMinutes: null }
  mockCalendars.length = 0
  mockCalendars.push(
    { id: "cal-main", household_id: "hh-mock", name: "Personal", color: "sage", source: "internal", feed_url: null, is_visible: true, created_by: null },
  )
  mockEvents.length = 0
  mockAnnouncements.length = 0
  mockTasks.length = 0
  mockTaskLists.length = 1
  mockTaskLists[0] = { id: "tl-mock", household_id: "hh-mock", name: "General", color: "taupe", position: 0 }
  mockMembers.length = 0
}

/** Seed household notification preferences (call after setupApiMocks, before goto). */
export function setMockNotifications(prefs: Record<string, unknown>) {
  mockNotifications = { ...mockNotifications, ...prefs }
}

/** Mark the household as already set up (lets mobile clients past the onboarding gate). */
export function setMockComplete(value = true) {
  mockComplete = value
}

/** Seed household members directly (used by mobile clients that skip onboarding). */
export function seedMockMembers(
  members: Array<{ id: string; name: string; role?: string; color?: string | null }>,
) {
  mockMembers.length = 0
  for (const m of members) {
    mockMembers.push({
      id: m.id,
      household_id: "hh-mock",
      name: m.name,
      avatar_url: null,
      color: m.color ?? null,
      role: m.role ?? "member",
      joined_at: new Date().toISOString(),
    })
  }
}

export function addMockEvent(overrides?: Record<string, unknown>) {
  const today = new Date()
  const dateStr = today.toISOString().slice(0, 10)
  const ev = {
    id: "ev-" + Date.now() + Math.random().toString(36).slice(2, 6),
    calendar_id: "cal-main", title: "Mock Event",
    description: "", start_at: dateStr + "T10:00:00Z",
    end_at: dateStr + "T11:00:00Z", all_day: false,
    recurrence: null, reminder_minutes: null, source: "internal", external_uid: null,
    created_by: "m1", created_at: today.toISOString(), updated_at: today.toISOString(),
    ...overrides,
  }
  mockEvents.push(ev)
  return ev
}

export function addMockAnnouncement(overrides?: Record<string, unknown>) {
  const a = {
    id: "ann-" + Date.now() + Math.random().toString(36).slice(2, 6),
    household_id: "hh-mock",
    message: "Mock announcement",
    created_by: null,
    author_name: null,
    created_at: new Date().toISOString(),
    expires_at: null,
    ...overrides,
  }
  mockAnnouncements.push(a)
  return a
}

export function addMockTask(overrides?: Record<string, unknown>) {
  const t = {
    id: "t-" + Date.now() + Math.random().toString(36).slice(2, 6),
    list_id: "tl-mock", title: "Mock Task", description: "",
    assignee_id: null, start_at: null, end_at: null,
    status: "todo", priority: "medium", position: mockTasks.length,
    created_by: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    ...overrides,
  }
  mockTasks.push(t)
  return t
}

function json(body: unknown) {
  return { status: 200, contentType: "application/json" as const, body: JSON.stringify(body) }
}

export async function setupApiMocks(page: Page) {
  resetMockState()

  // ── Settings ──
  await page.route("**/api/v1/household/settings", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill(json({
        isComplete: mockComplete, houseName: mockHouseName, address: mockAddress,
        notifications: mockNotifications,
      }))
    } else if (route.request().method() === "PATCH") {
      const body = JSON.parse(route.request().postData() || "{}")
      if (body.settings?.isComplete !== undefined) mockComplete = body.settings.isComplete
      if (body.settings?.houseName !== undefined) mockHouseName = body.settings.houseName
      if (body.settings?.address !== undefined) mockAddress = body.settings.address
      if (body.settings?.notifications !== undefined) {
        mockNotifications = { ...mockNotifications, ...body.settings.notifications }
      }
      await route.fulfill(json({ message: "ok" }))
    } else {
      await route.continue()
    }
  })

  // ── Members (stateful: POST/PATCH/DELETE mutate mockMembers) ──
  await page.route(/\/api\/v1\/household\/members/, async (route) => {
    const url = route.request().url()
    const method = route.request().method()
    const match = url.match(/\/members\/([^/?]+)/)
    const memberId = match?.[1]

    if (method === "GET") {
      await route.fulfill(json([...mockMembers]))
    } else if (method === "POST") {
      const body = JSON.parse(route.request().postData() || "{}")
      const newMember = { id: "m-" + Date.now(), household_id: "hh-mock", name: body.name, avatar_url: null, role: body.role || "member", joined_at: new Date().toISOString() }
      mockMembers.push(newMember as any)
      await route.fulfill(json(newMember))
    } else if (method === "PATCH" && memberId) {
      const body = JSON.parse(route.request().postData() || "{}")
      const idx = mockMembers.findIndex((m: any) => m.id === memberId)
      if (idx >= 0) {
        mockMembers[idx] = { ...mockMembers[idx], ...body } as any
        await route.fulfill(json(mockMembers[idx]))
      } else {
        await route.fulfill({ status: 404, contentType: "application/json", body: '{"detail":"Member not found"}' })
      }
    } else if (method === "DELETE" && memberId) {
      const idx = mockMembers.findIndex((m: any) => m.id === memberId)
      if (idx >= 0) {
        mockMembers.splice(idx, 1)
        await route.fulfill(json({ message: "Member deleted" }))
      } else {
        await route.fulfill({ status: 404, contentType: "application/json", body: '{"detail":"Member not found"}' })
      }
    } else {
      await route.continue()
    }
  })

  // ── Notifications ──
  await page.route("**/api/v1/notifications/test", async (route) => {
    const body = JSON.parse(route.request().postData() || "{}")
    const channels: string[] = body.channels ?? ["hud", "push"]
    const results: Record<string, string> = {}
    if (channels.includes("hud")) results.hud = "sent to the display"
    if (channels.includes("push")) results.push = "skipped: no devices have push turned on"
    await route.fulfill(json({ results }))
  })

  // ── Announcements (stateful: POST/DELETE mutate mockAnnouncements) ──
  await page.route(/\/api\/v1\/announcements/, async (route) => {
    const url = route.request().url()
    const method = route.request().method()
    const match = url.match(/\/announcements\/([^/?]+)/)
    const announcementId = match?.[1]

    if (method === "GET") {
      await route.fulfill(json([...mockAnnouncements]))
    } else if (method === "POST") {
      const body = JSON.parse(route.request().postData() || "{}")
      const author = mockMembers.find((m: any) => m.id === body.created_by) as any
      const createdAt = new Date()
      const expiresAt = body.duration_minutes != null
        ? new Date(createdAt.getTime() + body.duration_minutes * 60_000).toISOString()
        : null
      const announcement = {
        id: "ann-" + Date.now(),
        household_id: "hh-mock",
        message: body.message || "",
        created_by: body.created_by || null,
        author_name: author?.name ?? null,
        created_at: createdAt.toISOString(),
        expires_at: expiresAt,
      }
      mockAnnouncements.push(announcement)
      await route.fulfill(json(announcement))
    } else if (method === "DELETE" && announcementId) {
      const idx = mockAnnouncements.findIndex((a: any) => a.id === announcementId)
      if (idx >= 0) {
        mockAnnouncements.splice(idx, 1)
        await route.fulfill(json({ message: "Announcement removed" }))
      } else {
        await route.fulfill({ status: 404, contentType: "application/json", body: '{"detail":"Announcement not found"}' })
      }
    } else {
      await route.continue()
    }
  })

  // ── Calendars ──
  await page.route("**/api/v1/calendars", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill(json([...mockCalendars]))
    } else if (route.request().method() === "POST") {
      const body = JSON.parse(route.request().postData() || "{}")
      const cal = { id: "cal-" + Date.now(), household_id: "hh-mock", name: body.name || "Default", color: body.color || "sage", source: body.source || "internal", feed_url: null, is_visible: true, created_by: null }
      mockCalendars.push(cal)
      await route.fulfill(json(cal))
    } else {
      await route.continue()
    }
  })

  // ── Events ──
  await page.route(/\/api\/v1\/events/, async (route) => {
    const url = route.request().url()
    const method = route.request().method()
    const match = url.match(/\/events\/([^/?]+)/)
    const eventId = match?.[1]

    if (method === "GET") {
      await route.fulfill(json(mockEvents))
    } else if (method === "POST") {
      const body = JSON.parse(route.request().postData() || "{}")
      const calExists = mockCalendars.some((c: any) => c.id === body.calendar_id)
      if (!calExists) {
        await route.fulfill({ status: 404, contentType: "application/json", body: '{"detail":"Calendar not found"}' })
        return
      }
      const ev = {
        id: "ev-" + Date.now(), calendar_id: body.calendar_id, title: body.title || "",
        description: body.description || "", start_at: body.start_at || new Date().toISOString(),
        end_at: body.end_at || null, all_day: body.all_day || false, recurrence: body.recurrence || null,
        reminder_minutes: body.reminder_minutes ?? null,
        assignee_id: body.assignee_id || null,
        source: "internal", external_uid: null, created_by: null,
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      }
      mockEvents.push(ev)
      await route.fulfill(json(ev))
    } else if (method === "PATCH" && eventId) {
      const body = JSON.parse(route.request().postData() || "{}")
      const idx = mockEvents.findIndex((e: any) => e.id === eventId)
      if (idx >= 0) {
        mockEvents[idx] = { ...mockEvents[idx], ...body, updated_at: new Date().toISOString() } as any
        await route.fulfill(json(mockEvents[idx]))
      } else {
        await route.fulfill({ status: 404, contentType: "application/json", body: '{"detail":"Event not found"}' })
      }
    } else if (method === "DELETE" && eventId) {
      const idx = mockEvents.findIndex((e: any) => e.id === eventId)
      if (idx >= 0) {
        mockEvents.splice(idx, 1)
        await route.fulfill(json({ message: "Event deleted" }))
      } else {
        await route.fulfill({ status: 404, contentType: "application/json", body: '{"detail":"Event not found"}' })
      }
    } else {
      await route.continue()
    }
  })

  // ── Holidays ──
  await page.route("**/api/v1/holidays", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill(json(mockHolidays))
    } else if (route.request().method() === "POST") {
      await route.fulfill(json({ message: "Synced 2 holidays" }))
    } else {
      await route.continue()
    }
  })

  // ── Task Lists ──
  await page.route("**/api/v1/task-lists", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill(json(mockTaskLists))
    } else if (route.request().method() === "POST") {
      const body = JSON.parse(route.request().postData() || "{}")
      const tl = { id: "tl-" + Date.now(), household_id: "hh-mock", name: body.name || "List", color: body.color || "taupe", position: mockTaskLists.length }
      mockTaskLists.push(tl)
      await route.fulfill(json(tl))
    } else {
      await route.continue()
    }
  })

  // ── Tasks ──
  await page.route(/\/api\/v1\/tasks/, async (route) => {
    const url = route.request().url()
    const method = route.request().method()
    const match = url.match(/\/tasks\/([^/?]+)/)
    const taskId = match?.[1]

    if (method === "GET") {
      await route.fulfill(json(mockTasks))
    } else if (method === "POST") {
      const body = JSON.parse(route.request().postData() || "{}")
      const t = {
        id: "t-" + Date.now(), list_id: body.list_id || "tl-mock", title: body.title || "",
        description: body.description || "", assignee_id: body.assignee_id || null,
        start_at: body.start_at || null, end_at: body.end_at || null,
        status: body.status || "todo", priority: body.priority || "medium", position: mockTasks.length,
        created_by: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      }
      mockTasks.push(t)
      await route.fulfill(json(t))
    } else if (method === "PATCH" && taskId) {
      const body = JSON.parse(route.request().postData() || "{}")
      const idx = mockTasks.findIndex((t: any) => t.id === taskId)
      if (idx >= 0) {
        mockTasks[idx] = { ...mockTasks[idx], ...body, updated_at: new Date().toISOString() } as any
        await route.fulfill(json(mockTasks[idx]))
      } else {
        await route.fulfill({ status: 404, contentType: "application/json", body: '{"detail":"Task not found"}' })
      }
    } else if (method === "DELETE" && taskId) {
      const idx = mockTasks.findIndex((t: any) => t.id === taskId)
      if (idx >= 0) {
        mockTasks.splice(idx, 1)
        await route.fulfill(json({ message: "Task deleted" }))
      } else {
        await route.fulfill({ status: 404, contentType: "application/json", body: '{"detail":"Task not found"}' })
      }
    } else {
      await route.continue()
    }
  })
}
