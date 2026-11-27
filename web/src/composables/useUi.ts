import { ref, nextTick } from "vue"

export type PanelView = "home" | "calendar" | "tasks" | "announcements" | "settings"
export type DrawerType = "event-detail" | "task-detail" | "member-detail" | "quick-add" | "confirm" | null

export interface CalendarTarget {
  date: string
  eventId?: string
}

export interface DrawerState {
  type: DrawerType
  id: string | null
  date: string | null
  time: string | null
  intent?: "event" | "task" | null
  aiConversationId?: string | null
  aiEventId?: string | null
  aiEventTitle?: string | null
  aiSourceMessage?: string | null
}

const activePanel = ref<PanelView>("home")
const drawer = ref<DrawerState>({ type: null, id: null, date: null, time: null })
const isDrawerOpen = ref(false)
const announcementsOpen = ref(false)
const closeGuard = ref<(() => boolean) | null>(null)
const calendarTarget = ref<CalendarTarget | null>(null)

function setPanel(panel: PanelView) {
  activePanel.value = panel
}

function openCalendar(date: Date | string, eventId?: string) {
  const target = typeof date === "string" ? new Date(date) : date
  if (Number.isNaN(target.getTime())) return
  calendarTarget.value = { date: target.toISOString(), eventId }
  setPanel("calendar")
}

function consumeCalendarTarget(): CalendarTarget | null {
  const target = calendarTarget.value
  calendarTarget.value = null
  return target
}

function openDrawer(
  type: NonNullable<DrawerType>,
  id?: string,
  date?: string,
  time?: string,
  intent?: "event" | "task",
) {
  drawer.value = {
    type,
    id: id ?? null,
    date: date ?? null,
    time: time ?? null,
    ...(intent ? { intent } : {}),
  }
  nextTick(() => { isDrawerOpen.value = true })
}

function openAiConversation(
  conversationId: string,
  eventId: string,
  eventTitle?: string | null,
  sourceMessage?: string | null,
) {
  drawer.value = {
    type: "quick-add",
    id: null,
    date: null,
    time: null,
    intent: "event",
    aiConversationId: conversationId,
    aiEventId: eventId,
    aiEventTitle: eventTitle ?? null,
    aiSourceMessage: sourceMessage ?? null,
  }
  nextTick(() => { isDrawerOpen.value = true })
}

function openEventChat(
  eventId: string,
  eventTitle?: string | null,
  sourceMessage?: string | null,
) {
  drawer.value = {
    type: "quick-add",
    id: null,
    date: null,
    time: null,
    intent: "event",
    aiConversationId: null,
    aiEventId: eventId,
    aiEventTitle: eventTitle ?? null,
    aiSourceMessage: sourceMessage ?? null,
  }
  nextTick(() => { isDrawerOpen.value = true })
}

function closeDrawer() {
  if (closeGuard.value && !closeGuard.value()) return
  isDrawerOpen.value = false
  setTimeout(() => {
    drawer.value = { type: null, id: null, date: null, time: null }
    closeGuard.value = null
  }, 320)
}

function openAnnouncements() {
  announcementsOpen.value = true
}

function closeAnnouncements() {
  announcementsOpen.value = false
}

function registerCloseGuard(fn: () => boolean) {
  closeGuard.value = fn
}

function unregisterCloseGuard() {
  closeGuard.value = null
}

export function useUi() {
  return {
    activePanel,
    drawer,
    isDrawerOpen,
    announcementsOpen,
    calendarTarget,
    setPanel,
    openCalendar,
    consumeCalendarTarget,
    openDrawer,
    openAiConversation,
    openEventChat,
    closeDrawer,
    openAnnouncements,
    closeAnnouncements,
    registerCloseGuard,
    unregisterCloseGuard,
  }
}

export function _resetUi() {
  activePanel.value = "home"
  drawer.value = {
    type: null, id: null, date: null, time: null, intent: null,
    aiConversationId: null, aiEventId: null, aiEventTitle: null,
    aiSourceMessage: null,
  }
  isDrawerOpen.value = false
  announcementsOpen.value = false
  closeGuard.value = null
  calendarTarget.value = null
}
