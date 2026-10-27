import { ref, nextTick } from "vue"

export type PanelView = "home" | "calendar" | "tasks" | "announcements" | "settings"
export type DrawerType = "event-detail" | "task-detail" | "member-detail" | "quick-add" | "confirm" | null

export interface CalendarTarget {
  /** ISO timestamp for the day the calendar should land on. */
  date: string
  /** Event to open once the calendar has landed on the date. */
  eventId?: string
}

export interface DrawerState {
  type: DrawerType
  id: string | null
  date: string | null
  /** Optional start time (HH:MM) prefill — used by quick-add when opened from a timeline click */
  time: string | null
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

/**
 * Jump to the calendar panel focused on a date. When `eventId` is supplied the
 * calendar opens the event detail once it has landed on the day.
 */
function openCalendar(date: Date | string, eventId?: string) {
  const target = typeof date === "string" ? new Date(date) : date
  if (Number.isNaN(target.getTime())) return
  calendarTarget.value = { date: target.toISOString(), eventId }
  setPanel("calendar")
}

/** CalendarView consumes the target once so a later manual visit starts fresh. */
function consumeCalendarTarget(): CalendarTarget | null {
  const target = calendarTarget.value
  calendarTarget.value = null
  return target
}

function openDrawer(type: NonNullable<DrawerType>, id?: string, date?: string, time?: string) {
  drawer.value = { type, id: id ?? null, date: date ?? null, time: time ?? null }
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
    closeDrawer,
    openAnnouncements,
    closeAnnouncements,
    registerCloseGuard,
    unregisterCloseGuard,
  }
}

export function _resetUi() {
  activePanel.value = "home"
  drawer.value = { type: null, id: null, date: null, time: null }
  isDrawerOpen.value = false
  announcementsOpen.value = false
  closeGuard.value = null
  calendarTarget.value = null
}
