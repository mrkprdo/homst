import { config } from "@vue/test-utils"
import { beforeEach, vi } from "vitest"
import { _resetUi } from "@/composables/useUi"
import { _resetTasks } from "@/composables/useTasks"
import { _resetEvents } from "@/composables/useEvents"
import { _resetSettings } from "@/composables/useSettings"
import { _resetMembers } from "@/composables/useMembers"
import { _resetStream } from "@/composables/useStream"
import { _resetNotifications } from "@/composables/useNotifications"
import { _resetAnnouncements } from "@/composables/useAnnouncements"
import { _resetPush } from "@/composables/usePush"
import { _resetUpdatePrompt } from "@/composables/useUpdatePrompt"
import { _resetNotificationIntent } from "@/composables/useNotificationIntent"
import { _resetServerReachability } from "@/composables/useServerReachability"
import { _resetOfflineNotifications } from "@/composables/useOfflineNotifications"
import { _resetPushStore } from "@/lib/pushStore"
import { HOUSEHOLD_COMPLETE_KEY } from "@/lib/householdCache"

globalThis.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

globalThis.EventSource = class EventSource {
  onopen: (() => void) | null = null
  onerror: (() => void) | null = null
  addEventListener() {}
  close() {}
} as any

function buildResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
}

globalThis.fetch = vi.fn((url: string | URL, options?: RequestInit) => {
  const path = String(url)
  const method = (options?.method as string) || "GET"
  const postData = options?.body ? JSON.parse(options.body as string) : {}
  const isList = path.includes("/calendars") || path.includes("/events") || path.includes("/tasks") || path.includes("/task-lists") || path.includes("/members") || path.includes("/holidays") || path.includes("/announcements")

  if (isList && method === "GET") {
    return Promise.resolve(buildResponse([]))
  }

  if (path.includes("/events") && method === "POST") {
    return Promise.resolve(buildResponse({
      id: "ev-mock", calendar_id: postData.calendar_id || "cal-main",
      title: postData.title || "Test Event",
      description: postData.description || "",
      start_at: postData.start_at || "2026-05-15T10:00:00Z",
      end_at: postData.end_at || null,
      all_day: postData.all_day || false, recurrence: postData.recurrence || null,
      source: "internal", external_uid: null,
      created_by: null, created_at: "2026-05-15T00:00:00Z", updated_at: "2026-05-15T00:00:00Z",
    }))
  }

  if (path.includes("/tasks") && method === "POST") {
    return Promise.resolve(buildResponse({
      id: "t-mock", list_id: postData.list_id || "tl-mock",
      title: postData.title || "Test Task",
      description: postData.description || "",
      assignee_id: postData.assignee_id || null,
      start_at: postData.start_at || null, end_at: null,
      status: "todo", priority: postData.priority || "medium", position: 0,
      created_by: null, created_at: "2026-05-15T00:00:00Z", updated_at: "2026-05-15T00:00:00Z",
    }))
  }

  return Promise.resolve(buildResponse(isList ? [] : {}))
}) as unknown as typeof fetch

config.global.stubs = {
  PhHouse: true,
  PhUserCircle: true,
  PhGear: true,
  PhCalendar: true,
  PhKanban: true,
  PhCheckSquare: true,
  PhX: true,
  PhPlus: true,
  PhCaretLeft: true,
  PhCaretRight: true,
  PhUser: true,
  PhList: true,
  PhClock: true,
  PhFlag: true,
  PhDotsThree: true,
  PhTrash: true,
  PhCheck: true,
  PhArrowRight: true,
}

beforeEach(() => {
  _resetUi()
  _resetTasks()
  _resetEvents()
  _resetSettings()
  _resetMembers()
  _resetStream()
  _resetNotifications()
  _resetAnnouncements()
  _resetPush()
  _resetUpdatePrompt()
  _resetNotificationIntent()
  _resetServerReachability()
  _resetOfflineNotifications()
  _resetPushStore()
  localStorage.removeItem(HOUSEHOLD_COMPLETE_KEY)
  vi.clearAllMocks()
})
