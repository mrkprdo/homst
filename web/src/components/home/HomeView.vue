<script setup lang="ts">
import { ref, computed, reactive, watch, nextTick, onMounted, onUnmounted, type ComponentPublicInstance } from "vue"
import { useEvents } from "@/composables/useEvents"
import { useTasks } from "@/composables/useTasks"
import { useMembers } from "@/composables/useMembers"
import { useUi } from "@/composables/useUi"
import { useWeather } from "@/composables/useWeather"
import { useSpotify } from "@/composables/useSpotify"
import { useSettings } from "@/composables/useSettings"
import { useFittedList } from "@/composables/useFittedList"
import { useCardBlowup } from "@/composables/useCardBlowup"
import { expandEvents } from "@/utils/recurrence"
import type { Event as CalendarEvent } from "@/composables/useEvents"
import type { Task } from "@/composables/useTasks"
import { memberColorHex, type MemberColor } from "@/types/household"
import { wifiQrPayload } from "@/lib/wifiQr"
import { loadHousehold, ensureHouseholdLoaded } from "@/lib/hydrate"
import { householdApi } from "@/api/household"
import { PhArrowRight, PhCircle, PhCheckCircle, PhCalendarBlank, PhCaretLeft, PhCaretRight, PhLock, PhLockOpen, PhDotsSix, PhSun, PhWind, PhDropHalf, PhMusicNote, PhImage, PhHouse, PhListChecks, PhPlus, PhX } from "@phosphor-icons/vue"
import UiCard from "@/components/ui/UiCard.vue"
import UiButton from "@/components/ui/UiButton.vue"
import UiEmptyState from "@/components/ui/UiEmptyState.vue"
import CameraCard from "@/components/home/CameraCard.vue"
import WifiQr from "@/components/home/WifiQr.vue"
import TemperatureCard from "@/components/home/TemperatureCard.vue"
import WeatherScene from "@/components/home/WeatherScene.vue"
import { animate, stagger, springs, ease } from "@/lib/motion"
import { syncVinyl } from "@/lib/vinyl"
import {
  DEFAULT_LAYOUT,
  HOME_LAYOUT_EVENT,
  HOME_LAYOUT_STORAGE_KEY,
  writeCachedHomeLayout,
  type WidgetDef,
} from "@/lib/homeLayout"

const { events, prefetchAround } = useEvents()
const { todos, doing, ensureLoaded } = useTasks()
const { members, ensureLoaded: loadMembers } = useMembers()
const ui = useUi()
const settings = useSettings()

const {
  active: blowupActive,
  ready: blowupReady,
  label: blowupLabel,
  stageEl: blowupStageEl,
  closeEl: blowupCloseEl,
  open: openBlowup,
  close: closeBlowup,
} = useCardBlowup()

const WIDGET_LABELS: Record<string, string> = {
  datetime: "House",
  schedule: "Schedule",
  weather: "Weather",
  calendar: "Calendar",
  todos: "To Do",
  photos: "Photos",
  spotify: "Spotify",
  temperatures: "Temps",
  camera: "Camera",
}

const { weather, loading: weatherLoading, error: weatherError, refresh: refreshWeather, startAutoRefresh, stopAutoRefresh, weatherLabel } = useWeather()
const { currentTrack, connected: spotifyConnected, error: spotifyError, needsConfig: spotifyNeedsConfig, setClientId, connect: connectSpotify, init: initSpotify, disconnect: disconnectSpotify, formatTime } = useSpotify()
const setupClientId = ref("")
const setupError = ref("")
const vinylDiscEl = ref<HTMLElement | null>(null)

watch(
  () => [currentTrack.value?.id, currentTrack.value?.isPlaying],
  () => nextTick(() => syncVinyl(vinylDiscEl.value)),
)

function bindVinylDisc(el: Element | ComponentPublicInstance | null) {
  vinylDiscEl.value = (el as HTMLElement | null) ?? null
  syncVinyl(el as Element | null)
}
const spotifyRedirectUri = (() => {
  const { protocol, hostname, port } = window.location
  if (protocol === "http:" && !port) return `${protocol}//${hostname}:80`
  return window.location.origin
})()

function submitClientId() {
  const id = setupClientId.value.trim()
  if (!id) return
  if (!/^[0-9a-f]{32}$/i.test(id)) {
    setupError.value = "That doesn't look like a Spotify Client ID — it's 32 letters/digits (not the Client Secret)."
    return
  }
  setupError.value = ""
  setClientId(id)
  connectSpotify()
}

const today = ref(new Date())

const GRID_COLS = 6
const GRID_ROWS = 6
const GAP = 12

const MIN_SPAN = 1

const BALANCED_SIX_COLUMN_LAYOUT: WidgetDef[] = [
  { id: "datetime", col: 0, row: 0, w: 3, h: 2 },
  { id: "weather",  col: 3, row: 0, w: 3, h: 2 },
  { id: "schedule", col: 0, row: 2, w: 2, h: 2 },
  { id: "todos",   col: 2, row: 2, w: 2, h: 2 },
  { id: "spotify", col: 4, row: 2, w: 2, h: 2 },
  { id: "calendar", col: 0, row: 4, w: 4, h: 2 },
  { id: "photos",   col: 4, row: 4, w: 2, h: 2 },
]

const FOUR_COLUMN_DEFAULT_LAYOUT: WidgetDef[] = [
  { id: "datetime", col: 0, row: 0, w: 2, h: 1 },
  { id: "weather",  col: 2, row: 0, w: 2, h: 1 },
  { id: "schedule", col: 0, row: 1, w: 2, h: 1 },
  { id: "todos",   col: 2, row: 1, w: 2, h: 1 },
  { id: "calendar", col: 0, row: 2, w: 4, h: 2 },
  { id: "photos",   col: 2, row: 4, w: 2, h: 1 },
  { id: "spotify", col: 0, row: 4, w: 2, h: 1 },
]

const ORIGINAL_DEFAULT_LAYOUT: WidgetDef[] = [
  { id: "datetime", col: 0, row: 0, w: 2, h: 1 },
  { id: "weather",  col: 2, row: 0, w: 2, h: 1 },
  { id: "schedule", col: 0, row: 1, w: 1, h: 1 },
  { id: "todos",   col: 1, row: 1, w: 1, h: 1 },
  { id: "spotify", col: 2, row: 1, w: 2, h: 1 },
  { id: "calendar", col: 0, row: 2, w: 4, h: 2 },
  { id: "photos",   col: 0, row: 4, w: 4, h: 1 },
]

const LEGACY_OVERLAPPING_LAYOUT: WidgetDef[] = [
  { id: "datetime", col: 0, row: 0, w: 2, h: 1 },
  { id: "weather",  col: 2, row: 0, w: 2, h: 1 },
  { id: "schedule", col: 0, row: 1, w: 1, h: 1 },
  { id: "todos",   col: 1, row: 1, w: 1, h: 1 },
  { id: "spotify", col: 2, row: 1, w: 2, h: 2 },
  { id: "calendar", col: 0, row: 2, w: 4, h: 2 },
  { id: "photos",   col: 0, row: 4, w: 4, h: 1 },
]

const PRE_CAMERA_DEFAULT_LAYOUT: WidgetDef[] = [
  { id: "datetime", col: 3, row: 0, w: 1, h: 2 },
  { id: "weather",  col: 2, row: 0, w: 1, h: 2 },
  { id: "schedule", col: 0, row: 3, w: 2, h: 3 },
  { id: "todos",    col: 5, row: 0, w: 1, h: 2 },
  { id: "calendar", col: 0, row: 0, w: 2, h: 3 },
  { id: "photos",   col: 2, row: 2, w: 4, h: 4 },
  { id: "spotify",  col: 4, row: 0, w: 1, h: 2 },
]

const PRE_TEMPERATURE_DEFAULT_LAYOUT: WidgetDef[] = [
  { id: "datetime", col: 3, row: 0, w: 1, h: 2 },
  { id: "weather",  col: 2, row: 0, w: 1, h: 2 },
  { id: "schedule", col: 0, row: 3, w: 2, h: 3 },
  { id: "todos",    col: 5, row: 0, w: 1, h: 2 },
  { id: "calendar", col: 0, row: 0, w: 2, h: 3 },
  { id: "photos",   col: 2, row: 2, w: 4, h: 2 },
  { id: "spotify",  col: 4, row: 0, w: 1, h: 2 },
  { id: "camera",   col: 2, row: 4, w: 4, h: 2 },
]

const TEMPERATURE_CARD_DEFAULT_LAYOUT: WidgetDef[] = [
  { id: "datetime",     col: 3, row: 0, w: 1, h: 2 },
  { id: "weather",      col: 2, row: 0, w: 1, h: 2 },
  { id: "schedule",     col: 0, row: 3, w: 2, h: 3 },
  { id: "todos",        col: 5, row: 0, w: 1, h: 2 },
  { id: "calendar",     col: 0, row: 0, w: 2, h: 3 },
  { id: "temperatures", col: 2, row: 2, w: 2, h: 2 },
  { id: "photos",       col: 4, row: 2, w: 2, h: 2 },
  { id: "spotify",      col: 4, row: 0, w: 1, h: 2 },
  { id: "camera",       col: 2, row: 4, w: 4, h: 2 },
]

const OUTDATED_DEFAULT_LAYOUTS = [
  BALANCED_SIX_COLUMN_LAYOUT,
  FOUR_COLUMN_DEFAULT_LAYOUT,
  ORIGINAL_DEFAULT_LAYOUT,
  LEGACY_OVERLAPPING_LAYOUT,
  PRE_CAMERA_DEFAULT_LAYOUT,
  PRE_TEMPERATURE_DEFAULT_LAYOUT,
  TEMPERATURE_CARD_DEFAULT_LAYOUT,
]

function matchesLayout(layout: WidgetDef[], reference: WidgetDef[]): boolean {
  if (layout.length !== reference.length) return false
  return reference.every(def => {
    const w = layout.find(x => x.id === def.id)
    return !!w && w.col === def.col && w.row === def.row && w.w === def.w && w.h === def.h
  })
}

function isOutdatedDefaultLayout(layout: WidgetDef[]): boolean {
  return OUTDATED_DEFAULT_LAYOUTS.some(reference => matchesLayout(layout, reference))
}

function findFreeSlot(w: number, h: number, existing: WidgetDef[]): { col: number; row: number } | null {
  for (let row = 0; row <= GRID_ROWS - h; row++) {
    for (let col = 0; col <= GRID_COLS - w; col++) {
      if (!existing.some(e =>
        col < e.col + e.w && col + w > e.col &&
        row < e.row + e.h && row + h > e.row
      )) {
        return { col, row }
      }
    }
  }
  return null
}

function withDefaultWidgets(layout: WidgetDef[]): { layout: WidgetDef[]; added: boolean } {
  const merged = layout.map(w => ({ ...w }))
  let added = false
  for (const def of DEFAULT_LAYOUT) {
    if (merged.some(w => w.id === def.id)) continue
    const sizes: Array<[number, number]> = [
      [def.w, def.h],
      [2, 2],
      [2, 1],
      [1, 1],
    ]
    let placed = false
    for (const [w, h] of sizes) {
      const slot = findFreeSlot(w, h, merged)
      if (slot) {
        merged.push({ ...def, col: slot.col, row: slot.row, w, h })
        placed = true
        break
      }
    }
    if (!placed) merged.push({ ...def })
    added = true
  }
  return { layout: merged, added }
}

function readCachedLayout(): WidgetDef[] | null {
  try {
    const raw = localStorage.getItem(HOME_LAYOUT_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return null
    if (parsed.some((w: any) =>
      typeof w?.id !== 'string' ||
      [w?.col, w?.row, w?.w, w?.h].some(n => typeof n !== 'number')
    )) return null
    const layout = parsed as WidgetDef[]
    const source = isOutdatedDefaultLayout(layout)
      ? DEFAULT_LAYOUT.map(w => ({ ...w }))
      : layout
    return withDefaultWidgets(source).layout
  } catch {
    return null
  }
}

const cachedLayout = readCachedLayout()
const widgets = reactive<WidgetDef[]>((cachedLayout ?? DEFAULT_LAYOUT).map(w => ({ ...w })))
const layoutReady = ref(!!cachedLayout)

function applyLayout(layout: WidgetDef[]) {
  const migrated = isOutdatedDefaultLayout(layout)
  const source = migrated ? DEFAULT_LAYOUT : layout
  const ids = source.map(w => w.id)
  const required = ["datetime", "schedule", "weather", "calendar", "todos"]
  if (!required.every(id => ids.includes(id))) return
  if (source.some(w => [w.col, w.row, w.w, w.h].some(n => typeof n !== "number"))) return
  const { layout: merged, added } = withDefaultWidgets(source)
  widgets.splice(0, widgets.length, ...merged)
  writeCachedHomeLayout(widgets.map(({ id, col, row, w, h }) => ({ id, col, row, w, h })))
  if (migrated || added) saveLayout()
}

function saveLayout() {
  const layout = widgets.map(({ id, col, row, w, h }) => ({ id, col, row, w, h }))
  writeCachedHomeLayout(layout)
  householdApi.updateSettings({ widgetLayout: layout }).catch(() => { })
}

const unlocked = ref(false)
const lockBtnEl = ref<HTMLElement | null>(null)

const widgetEls: Record<string, HTMLElement> = {}
function registerWidgetEl(id: string, el: HTMLElement | null) {
  if (el) {
    el.dataset.widgetId = id
    widgetEls[id] = el
  } else {
    delete widgetEls[id]
  }
}

const canvasEl = ref<HTMLElement | null>(null)
const canvasW = ref(0)
const canvasH = ref(0)
let ro: ResizeObserver | null = null

const colUnit = computed(() => canvasW.value > 0 ? (canvasW.value + GAP) / GRID_COLS : 200)
const rowUnit = computed(() => canvasH.value > 0 ? (canvasH.value + GAP) / GRID_ROWS : 200)

let clockTimer: ReturnType<typeof setInterval>
const _clockInit = new Date()
const dateStr = ref(_clockInit.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }))
const timeStr = ref(_clockInit.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" }))

const clockParts = computed(() => {
  const [clock = "", period = ""] = timeStr.value.trim().split(/\s+/)
  const [hours = "", minutes = "", seconds = ""] = clock.split(":")
  return { hours, minutes, seconds, period }
})

const wifiPayload = computed(() => wifiQrPayload({
  ssid: settings.wifiSsid.value,
  password: settings.wifiPassword.value,
  encryption: settings.wifiEncryption.value,
  hidden: settings.wifiHidden.value,
}))

const SCHEDULE_RESET_MS = 2 * 60 * 1000
const scheduleDayOffset = ref(0)
let scheduleResetTimer: ReturnType<typeof setTimeout> | null = null
let prefetchedScheduleMonth = `${new Date().getFullYear()}-${new Date().getMonth()}`

function clearScheduleReset() {
  if (scheduleResetTimer !== null) {
    clearTimeout(scheduleResetTimer)
    scheduleResetTimer = null
  }
}

function armScheduleReset() {
  clearScheduleReset()
  if (scheduleDayOffset.value !== 0) {
    scheduleResetTimer = setTimeout(() => {
      scheduleDayOffset.value = 0
      scheduleResetTimer = null
    }, SCHEDULE_RESET_MS)
  }
}

function goToScheduleDay(offset: number) {
  scheduleDayOffset.value = offset
  armScheduleReset()
}

function stepScheduleDay(delta: -1 | 1) {
  goToScheduleDay(scheduleDayOffset.value + delta)
}

function resetScheduleToToday() {
  scheduleDayOffset.value = 0
  clearScheduleReset()
}

watch(() => ui.activePanel.value, panel => {
  if (panel !== "home") {
    resetScheduleToToday()
    closeBlowup()
  }
})

const scheduleDate = computed(() => {
  const date = new Date(today.value)
  date.setHours(0, 0, 0, 0)
  date.setDate(date.getDate() + scheduleDayOffset.value)
  return date
})

watch(scheduleDate, date => {
  const key = `${date.getFullYear()}-${date.getMonth()}`
  if (key === prefetchedScheduleMonth) return
  prefetchedScheduleMonth = key
  void prefetchAround(date.getFullYear(), date.getMonth())
})

const scheduleRelativeLabel = computed(() => {
  const offset = scheduleDayOffset.value
  if (offset === 0) return "Today"
  if (offset === -1) return "Yesterday"
  if (offset === 1) return "Tomorrow"
  return scheduleDate.value.toLocaleDateString("en-US", { weekday: "long" })
})

const scheduleDateLabel = computed(() => {
  const date = scheduleDate.value
  const sameYear = date.getFullYear() === today.value.getFullYear()
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  })
})

const scheduleDateLong = computed(() =>
  scheduleDate.value.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })
)

function addEventFromMiniCalendar() {
  const date = scheduleDate.value
  const value = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
  ui.openDrawer("quick-add", undefined, value, undefined, "event")
}

const scheduleTitle = computed(() => `${scheduleRelativeLabel.value}'s Schedule`)

const viewYear  = ref(today.value.getFullYear())
const viewMonth = ref(today.value.getMonth())

const displayEvents = computed<CalendarEvent[]>(() => {
  const monthStart = new Date(viewYear.value, viewMonth.value, 1)
  const monthEnd   = new Date(viewYear.value, viewMonth.value + 1, 0, 23, 59, 59, 999)
  const dayStart   = new Date(scheduleDate.value)
  const dayEnd     = new Date(scheduleDate.value)
  dayEnd.setDate(dayEnd.getDate() + 1)
  dayEnd.setMilliseconds(-1)
  const from = new Date(Math.min(monthStart.getTime(), dayStart.getTime()) - 86_400_000)
  const to   = new Date(Math.max(monthEnd.getTime(), dayEnd.getTime()) + 86_400_000)
  return expandEvents(events.value, from, to)
})

const monthDisplayEvents = computed<CalendarEvent[]>(() => {
  const monthStart = new Date(viewYear.value, viewMonth.value, 1)
  const monthEnd   = new Date(viewYear.value, viewMonth.value + 1, 0, 23, 59, 59, 999)
  return expandEvents(
    events.value,
    new Date(monthStart.getTime() - 86_400_000),
    new Date(monthEnd.getTime() + 86_400_000),
  )
})

function eventCoversDate(e: { startAt: string; endAt: string | null; allDay: boolean }, date: Date): boolean {
  const start = new Date(e.startAt)
  const dayStart = new Date(date); dayStart.setHours(0, 0, 0, 0)
  const dayEnd = new Date(dayStart); dayEnd.setDate(dayEnd.getDate() + 1)
  if (start >= dayEnd) return false
  let end = e.endAt ? new Date(e.endAt) : start
  if (e.allDay && end.getTime() <= start.getTime()) end = new Date(start.getTime() + 1)
  return end >= dayStart
}

function compareEventsByStart(a: CalendarEvent, b: CalendarEvent) {
  if (a.allDay !== b.allDay) return a.allDay ? -1 : 1
  return new Date(a.startAt).getTime() - new Date(b.startAt).getTime()
}

const scheduleEvents = computed(() => {
  const date = scheduleDate.value
  return displayEvents.value
    .filter(event => eventCoversDate(event, date))
    .slice()
    .sort(compareEventsByStart)
})

const scheduleEmptyMessage = computed(() => {
  const label = scheduleRelativeLabel.value
  return label === "Today" || label === "Yesterday" || label === "Tomorrow"
    ? `No events ${label.toLowerCase()}`
    : `No events on ${scheduleDateLabel.value}`
})

function scheduleTime(event: CalendarEvent): string {
  return event.allDay ? "All day" : formatEventTime(event.startAt)
}

function openScheduleEvent(event: CalendarEvent) {
  ui.openCalendar(event.startAt, event.id.split("::")[0])
}

const monthName = computed(() =>
  new Date(viewYear.value, viewMonth.value, 1).toLocaleString("en-US", { month: "long", year: "numeric" })
)

const isViewingCurrentMonth = computed(() =>
  viewYear.value === today.value.getFullYear() && viewMonth.value === today.value.getMonth()
)

function stepCalendarMonth(delta: -1 | 1) {
  const next = new Date(viewYear.value, viewMonth.value + delta, 1)
  viewYear.value = next.getFullYear()
  viewMonth.value = next.getMonth()
  void prefetchAround(viewYear.value, viewMonth.value)
}

function resetCalendarMonth() {
  if (isViewingCurrentMonth.value) return
  viewYear.value = today.value.getFullYear()
  viewMonth.value = today.value.getMonth()
}

interface MiniCalendarDay {
  date: Date | null
  n: number | null
  events: CalendarEvent[]
}

const calendarDays = computed<MiniCalendarDay[]>(() => {
  const year = viewYear.value
  const month = viewMonth.value
  const firstDay = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const days: MiniCalendarDay[] = []
  for (let i = 0; i < firstDay; i++) days.push({ date: null, n: null, events: [] })
  for (let d = 1; d <= daysInMonth; d++) {
    const date = new Date(year, month, d)
    const dayEvents = monthDisplayEvents.value
      .filter(event => eventCoversDate(event, date))
      .sort(compareEventsByStart)
    days.push({ date, n: d, events: dayEvents })
  }
  return days
})

function isToday(date: Date | null): boolean {
  return !!date && date.toDateString() === today.value.toDateString()
}

function isWeekend(date: Date | null): boolean {
  return !!date && (date.getDay() === 0 || date.getDay() === 6)
}

function eventColor(event: CalendarEvent): string {
  const member = event.assigneeId
    ? members.value.find(m => m.id === event.assigneeId)
    : undefined
  if (!member) return "var(--color-primary)"
  return member.color.startsWith("#")
    ? member.color
    : memberColorHex(member.color as MemberColor)
}

function miniEventStyle(event: CalendarEvent) {
  return { "--mini-event-color": eventColor(event) }
}

function formatEventTime(startAt: string): string {
  return new Date(startAt).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })
}

function dayAriaLabel(day: MiniCalendarDay): string | undefined {
  if (!day.date) return undefined
  const base = day.date.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })
  return day.events.length
    ? `${base}, ${day.events.length} event${day.events.length === 1 ? "" : "s"}`
    : base
}

function dayEventTooltip(day: MiniCalendarDay): string | undefined {
  if (!day.date) return undefined
  const base = day.date.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })
  if (!day.events.length) return base
  const lines = day.events.slice(0, 5).map(event =>
    event.allDay ? event.title : `${formatEventTime(event.startAt)}  ${event.title}`
  )
  if (day.events.length > 5) lines.push(`+${day.events.length - 5} more`)
  return `${base}\n${lines.join("\n")}`
}

const homeTodos = computed(() => todos.value.slice(0, 8))
const homeDoing = computed(() => doing.value.slice(0, 3))

interface ScheduleEntry {
  kind: "row"
  event: CalendarEvent
  assignee: { name: string; color: string } | null
  isNow: boolean
  isPast: boolean
}

const scheduleEntries = computed<ScheduleEntry[]>(() => {
  const nowMs = today.value.getTime()
  const showLiveState = scheduleDayOffset.value === 0
  return scheduleEvents.value.map(event => {
    const member = event.assigneeId
      ? members.value.find(m => m.id === event.assigneeId)
      : undefined
    const start = new Date(event.startAt).getTime()
    const end = event.endAt ? new Date(event.endAt).getTime() : start
    return {
      kind: "row" as const,
      event,
      assignee: member
        ? {
            name: member.name,
            color: member.color.startsWith("#")
              ? member.color
              : memberColorHex(member.color as MemberColor),
          }
        : null,
      isNow: showLiveState && !event.allDay && start <= nowMs && nowMs < end,
      isPast: showLiveState && !event.allDay && end <= nowMs,
    }
  })
})
const scheduleListEl = ref<HTMLElement | null>(null)
const {
  visible: visibleScheduleEvents,
  hiddenCount: hiddenScheduleCount,
} = useFittedList({
  container: scheduleListEl,
  entries: () => scheduleEntries.value,
  measureKey: () => settings.fontSize.value,
})

interface HomeTodoEntry {
  kind: "label" | "task"
  key: string
  text?: string
  task?: Task
  doing?: boolean
}

const showTodoLabels = computed(() => (getWidget("todos")?.h ?? 1) >= 2)

const todoEntries = computed<HomeTodoEntry[]>(() => {
  const entries: HomeTodoEntry[] = []
  if (showTodoLabels.value && homeDoing.value.length) {
    entries.push({ kind: "label", key: "label-doing", text: "In progress" })
  }
  for (const task of homeDoing.value) {
    entries.push({ kind: "task", key: `doing-${task.id}`, task, doing: true })
  }
  if (showTodoLabels.value && homeDoing.value.length && homeTodos.value.length) {
    entries.push({ kind: "label", key: "label-next", text: "Up next" })
  }
  for (const task of homeTodos.value) {
    entries.push({ kind: "task", key: `todo-${task.id}`, task, doing: false })
  }
  return entries
})

const todoListEl = ref<HTMLElement | null>(null)
const {
  visible: visibleTodoEntries,
  hiddenCount: hiddenTodoCount,
} = useFittedList({
  container: todoListEl,
  entries: () => todoEntries.value,
  measureKey: () => settings.fontSize.value,
})

const activePhotos = computed(() =>
  (Array.isArray(settings.photos.value) ? settings.photos.value : [])
    .filter(p => p?.selected)
)
const PHOTO_INTERVAL_MS = 5000
const slideshowNow = ref(Date.now())
const currentPhotoIndex = computed(() => {
  const n = activePhotos.value.length
  return n > 0 ? Math.floor(slideshowNow.value / PHOTO_INTERVAL_MS) % n : 0
})
const currentPhoto = computed(() => activePhotos.value[currentPhotoIndex.value] ?? null)

interface PhotoSlide {
  key: number
  url: string
  backdrop: string
  dissolving: boolean
}

const PHOTO_DISSOLVE_MS = 2000

const PHOTO_BACKDROP_SIZE = 128
const PHOTO_BACKDROP_BLUR = 2

async function blurPhotoBackdrop(url: string): Promise<string> {
  if (typeof document === "undefined" || typeof Image === "undefined") return ""
  try {
    const img = new Image()
    img.src = url
    if (typeof img.decode === "function") await img.decode()
    if (!img.naturalWidth || !img.naturalHeight) return ""

    const canvas = document.createElement("canvas")
    const scale = PHOTO_BACKDROP_SIZE / Math.max(img.naturalWidth, img.naturalHeight)
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale))
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale))

    const context = canvas.getContext("2d")
    if (!context || typeof canvas.toDataURL !== "function") return ""
    if (typeof (context as CanvasRenderingContext2D).filter !== "string") return ""

    const zoom = 1 + (6 * PHOTO_BACKDROP_BLUR) / Math.min(canvas.width, canvas.height)
    const width = canvas.width * zoom
    const height = canvas.height * zoom
    context.filter = `blur(${PHOTO_BACKDROP_BLUR}px) saturate(1.15) brightness(0.55)`
    context.drawImage(img, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height)
    return canvas.toDataURL("image/jpeg", 0.85)
  } catch {
    return ""
  }
}

let photoSlideSeq = 0
let photoRequest = 0
const photoSlides = ref<PhotoSlide[]>([])
let photoSlideCleanup: ReturnType<typeof setTimeout> | null = null

function clearPhotoSlideCleanup() {
  if (photoSlideCleanup !== null) {
    clearTimeout(photoSlideCleanup)
    photoSlideCleanup = null
  }
}

watch(() => currentPhoto.value?.url ?? null, async (url) => {
  const request = ++photoRequest
  clearPhotoSlideCleanup()

  if (!url) {
    photoSlides.value = []
    return
  }

  const backdrop = await blurPhotoBackdrop(url)
  if (request !== photoRequest) return

  const dissolving = photoSlides.value.length > 0
  photoSlides.value = [
    ...photoSlides.value.slice(-1),
    { key: ++photoSlideSeq, url, backdrop, dissolving },
  ]
  if (dissolving) {
    photoSlideCleanup = setTimeout(() => {
      photoSlideCleanup = null
      if (photoSlides.value.length > 1) photoSlides.value = photoSlides.value.slice(-1)
    }, PHOTO_DISSOLVE_MS + 120)
  }
}, { immediate: true })

const PHOTO_PRELOAD_AHEAD = 2
let preloadedPhotos: HTMLImageElement[] = []
watch([currentPhotoIndex, activePhotos], () => {
  preloadedPhotos = []
  const photos = activePhotos.value
  if (!photos.length) return
  for (let step = 1; step <= PHOTO_PRELOAD_AHEAD; step++) {
    const url = photos[(currentPhotoIndex.value + step) % photos.length]?.url
    if (!url) continue
    const img = new Image()
    img.decoding = "async"
    img.src = url
    preloadedPhotos.push(img)
  }
}, { immediate: true })

let photoTimer: ReturnType<typeof setInterval>

let dragType: "move" | "resize" | null = null
let dragWidgetId: string | null = null
let dragStartCol = 0
let dragStartRow = 0
let dragStartW = 0
let dragStartH = 0
let dragPointerX = 0
let dragPointerY = 0
let dragLastCol = 0
let dragLastRow = 0
let dragLastW = 0
let dragLastH = 0

const draggingId = ref<string | null>(null)
const resizingId = ref<string | null>(null)

function findWidget(id: string): WidgetDef | undefined {
  return widgets.find(w => w.id === id)
}

function checkCollision(w: WidgetDef, col: number, row: number, ww: number, wh: number): boolean {
  return widgets.some(other =>
    other.id !== w.id &&
    col < other.col + other.w &&
    col + ww > other.col &&
    row < other.row + other.h &&
    row + wh > other.row
  )
}

function onWindowPointerMove(e: PointerEvent) {
  if (!dragType || !dragWidgetId) return
  const w = findWidget(dragWidgetId)
  if (!w) return

  const dx = e.clientX - dragPointerX
  const dy = e.clientY - dragPointerY

  if (dragType === "move") {
    const colDelta = Math.round(dx / colUnit.value)
    const rowDelta = Math.round(dy / rowUnit.value)
    const newCol = Math.max(0, Math.min(GRID_COLS - w.w, dragStartCol + colDelta))
    const newRow = Math.max(0, Math.min(GRID_ROWS - w.h, dragStartRow + rowDelta))

    if ((newCol !== dragLastCol || newRow !== dragLastRow) && !checkCollision(w, newCol, newRow, w.w, w.h)) {
      w.col = newCol
      w.row = newRow
      dragLastCol = newCol
      dragLastRow = newRow
    }
  } else if (dragType === "resize") {
    const colDelta = Math.round(dx / colUnit.value)
    const rowDelta = Math.round(dy / rowUnit.value)
    const maxW = GRID_COLS - w.col
    const maxH = GRID_ROWS - w.row
    const newW = Math.min(maxW, Math.max(MIN_SPAN, dragStartW + colDelta))
    const newH = Math.min(maxH, Math.max(MIN_SPAN, dragStartH + rowDelta))

    if ((newW !== dragLastW || newH !== dragLastH) && !checkCollision(w, w.col, w.row, newW, newH)) {
      w.w = newW
      w.h = newH
      dragLastW = newW
      dragLastH = newH
    }
  }
}

function onWindowPointerUp() {
  if (!dragType) return
  const releasedId = dragWidgetId

  dragType = null
  dragWidgetId = null
  draggingId.value = null
  resizingId.value = null

  stopDragListeners()
  saveLayout()

  if (releasedId) {
    const el = widgetEls[releasedId]
    if (el) animate(el, { scale: 1, translateY: 0, ease: springs.enter })
  }
}

function startDragListeners() {
  window.addEventListener("pointermove", onWindowPointerMove)
  window.addEventListener("pointerup", onWindowPointerUp)
  window.addEventListener("pointercancel", onWindowPointerUp)
}

function stopDragListeners() {
  window.removeEventListener("pointermove", onWindowPointerMove)
  window.removeEventListener("pointerup", onWindowPointerUp)
  window.removeEventListener("pointercancel", onWindowPointerUp)
}

function onDragHandleDown(e: PointerEvent, id: string) {
  if (!unlocked.value) return
  e.preventDefault()
  e.stopPropagation()
  const w = findWidget(id)
  if (!w) return

  dragType = "move"
  dragWidgetId = id
  dragStartCol = w.col
  dragStartRow = w.row
  dragPointerX = e.clientX
  dragPointerY = e.clientY
  dragLastCol = w.col
  dragLastRow = w.row
  draggingId.value = id

  startDragListeners()

  const el = widgetEls[id]
  if (el) animate(el, { scale: 1.04, translateY: -6, duration: 100, ease: ease.outFast })
}

function onResizeHandleDown(e: PointerEvent, id: string) {
  if (!unlocked.value) return
  e.preventDefault()
  e.stopPropagation()
  const w = findWidget(id)
  if (!w) return

  dragType = "resize"
  dragWidgetId = id
  dragStartW = w.w
  dragStartH = w.h
  dragStartCol = w.col
  dragStartRow = w.row
  dragPointerX = e.clientX
  dragPointerY = e.clientY
  dragLastW = w.w
  dragLastH = w.h
  resizingId.value = id

  startDragListeners()
}

function toggleLock() {
  unlocked.value = !unlocked.value
  if (lockBtnEl.value) {
    animate(lockBtnEl.value, { scale: [0.84, 1], ease: springs.item })
  }
}

const rootEl = ref<HTMLElement | null>(null)

function onLayoutUpdated(e: Event) {
  applyLayout((e as CustomEvent).detail as WidgetDef[])
}

onMounted(async () => {
  const hydrated = await ensureHouseholdLoaded().catch(() => null)
  if (!hydrated) {
    const stored = await householdApi.getSettings().catch(() => null)
    if (stored) settings.applyHouseholdSettings(stored)
  }
  if (settings.widgetLayout.value.length) {
    applyLayout(settings.widgetLayout.value)
  }
  layoutReady.value = true

  window.addEventListener(HOME_LAYOUT_EVENT, onLayoutUpdated)

  const weatherOpts = {
    address: settings.address.value,
    country: settings.holidayCountry.value,
    province: settings.holidayProvince.value,
    lat: settings.lat.value ?? undefined,
    lon: settings.lon.value ?? undefined,
  }
  refreshWeather(weatherOpts)
  startAutoRefresh(weatherOpts)

  const now = new Date()
  ensureLoaded()
  loadMembers()
  prefetchAround(now.getFullYear(), now.getMonth())
  initSpotify()

  photoTimer = setInterval(() => { slideshowNow.value = Date.now() }, 1000)

  clockTimer = setInterval(() => {
    const d = new Date()
    timeStr.value = d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    if (d.getSeconds() === 0) {
      dateStr.value = d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })
      today.value = d
    }
  }, 1000)

  if (canvasEl.value) {
    ro = new ResizeObserver(([entry]) => {
      canvasW.value = entry.contentRect.width
      canvasH.value = entry.contentRect.height
    })
    ro.observe(canvasEl.value)
  }

  const blocks = rootEl.value?.querySelectorAll(".home-block")
  if (blocks?.length) {
    animate(blocks, { opacity: [0, 1], translateY: [10, 0], duration: 180, ease: ease.outFast, delay: stagger(40) })
  }
})

onUnmounted(() => {
  window.removeEventListener(HOME_LAYOUT_EVENT, onLayoutUpdated)
  clearInterval(photoTimer)
  clearInterval(clockTimer)
  photoRequest += 1
  clearPhotoSlideCleanup()
  clearScheduleReset()
  ro?.disconnect()
  stopDragListeners()
  stopAutoRefresh()
})

function widgetStyle(w: WidgetDef) {
  return {
    gridColumn: `${w.col + 1} / span ${w.w}`,
    gridRow: `${w.row + 1} / span ${w.h}`,
  }
}

function getWidget(id: string) { return widgets.find(w => w.id === id) }

function onCanvasDoubleClick(e: MouseEvent) {
  if (unlocked.value || dragType || blowupActive.value) return
  const target = e.target as HTMLElement | null
  if (!target) return
  if (target.closest("button, a, input, select, textarea, summary, label, [role='button'], [role='link'], [contenteditable='true']")) return
  const widget = target.closest<HTMLElement>(".widget")
  if (!widget || !canvasEl.value?.contains(widget)) return
  const id = widget.dataset.widgetId
  if (!id) return
  void openBlowup(widget, WIDGET_LABELS[id] ?? "Card")
}
</script>

<template>
  <div ref="rootEl" class="home-view">
    <div v-if="layoutReady" ref="canvasEl" class="widget-canvas" :class="{ 'is-editing': unlocked }" :style="{
      gridTemplateColumns: `repeat(${GRID_COLS}, 1fr)`,
      gridTemplateRows: `repeat(${GRID_ROWS}, 1fr)`,
      gap: `${GAP}px`,
    }" @dblclick="onCanvasDoubleClick">
      <template v-if="unlocked">
        <div v-for="i in GRID_COLS * GRID_ROWS" :key="'gc-' + i" class="grid-cell-bg" aria-hidden="true" :style="{
          gridColumn: `${((i - 1) % GRID_COLS) + 1}`,
          gridRow: `${Math.floor((i - 1) / GRID_COLS) + 1}`,
        }" />
      </template>

      <div :ref="(el) => registerWidgetEl('datetime', el as HTMLElement | null)" class="widget"
        :class="{ 'is-dragging': draggingId === 'datetime' }"
        :style="{ ...widgetStyle(getWidget('datetime')!), '--wobble-delay': '0ms' }">
        <UiCard class="home-block datetime-card house-card" :padding="false">
          <div class="block-header">
            <span class="block-title">
              <PhHouse :size="18" /><span class="block-title-text">House</span>
            </span>
          </div>
          <div class="house-body">
            <div class="house-time" aria-hidden="true">
              <p class="datetime-time">
                <span class="datetime-clock">{{ clockParts.hours }}:{{ clockParts.minutes }}</span>
                <span class="datetime-clock-side">
                  <span class="datetime-seconds">{{ clockParts.seconds }}</span>
                  <span class="datetime-period">{{ clockParts.period }}</span>
                </span>
              </p>
              <div class="datetime-meta">
                <p class="datetime-house">{{ settings.houseName.value || 'Home' }}</p>
                <p class="datetime-date">{{ dateStr }}</p>
              </div>
            </div>

            <div
              v-if="wifiPayload"
              class="house-wifi"
              :title="`Scan to join ${settings.wifiSsid.value}`"
            >
              <WifiQr
                class="house-wifi__code"
                :payload="wifiPayload"
                :label="`Wi-Fi QR code for ${settings.wifiSsid.value}`"
              />
              <p class="house-wifi__label">WiFi</p>
            </div>
          </div>
        </UiCard>
        <div v-if="unlocked" class="drag-handle" @pointerdown="onDragHandleDown($event, 'datetime')">
          <PhDotsSix :size="14" />
        </div>
        <div v-if="unlocked" class="resize-handle" @pointerdown="onResizeHandleDown($event, 'datetime')" />
      </div>

      <div :ref="(el) => registerWidgetEl('schedule', el as HTMLElement | null)" class="widget"
        :class="{ 'is-dragging': draggingId === 'schedule' }"
        :style="{ ...widgetStyle(getWidget('schedule')!), '--wobble-delay': '220ms' }">
        <UiCard class="home-block" :padding="false">
          <div class="block-header">
            <span class="block-title">
              <PhCalendarBlank :size="18" /><span class="block-title-text">{{ scheduleTitle }}</span>
            </span>
            <UiButton variant="link" size="sm" @click="ui.setPanel('calendar')">
              Calendar
              <PhArrowRight :size="13" />
            </UiButton>
          </div>

          <div class="schedule-nav">
            <button type="button" class="schedule-nav__arrow" aria-label="Previous day"
              @click="stepScheduleDay(-1)">
              <PhCaretLeft :size="14" weight="bold" />
            </button>
            <button type="button" class="schedule-nav__active"
              :class="{ 'is-today': scheduleDayOffset === 0 }"
              :title="scheduleDayOffset === 0 ? undefined : 'Show today'"
              :aria-label="scheduleDayOffset === 0 ? scheduleDateLong : `Show today. Currently ${scheduleDateLong}`"
              @click="resetScheduleToToday()">
              <span class="schedule-nav__label">{{ scheduleRelativeLabel }}</span>
              <span class="schedule-nav__date">{{ scheduleDateLabel }}</span>
            </button>
            <button type="button" class="schedule-nav__arrow" aria-label="Next day"
              @click="stepScheduleDay(1)">
              <PhCaretRight :size="14" weight="bold" />
            </button>
          </div>

          <div v-if="scheduleEntries.length" ref="scheduleListEl" class="schedule-list">
            <button v-for="entry in visibleScheduleEvents" :key="entry.event.id" type="button" class="schedule-row"
              :class="{ 'schedule-row--now': entry.isNow, 'schedule-row--past': entry.isPast }"
              :title="`Open ${entry.event.title} in the calendar`"
              @click="openScheduleEvent(entry.event)">
              <span class="schedule-time" :class="{ 'schedule-time--allday': entry.event.allDay }">
                {{ scheduleTime(entry.event) }}
              </span>
              <span class="schedule-dot" aria-hidden="true"
                :style="{ background: entry.assignee?.color ?? 'var(--color-borderStrong)' }" />
              <span class="schedule-title">{{ entry.event.title }}</span>
              <span v-if="entry.isNow" class="schedule-now">Now</span>
              <span v-if="entry.assignee" class="schedule-assignee">{{ entry.assignee.name }}</span>
            </button>
            <p v-if="hiddenScheduleCount > 0" class="list-more">+{{ hiddenScheduleCount }} more</p>
          </div>
          <UiEmptyState v-else class="widget-empty" :message="scheduleEmptyMessage">
            <template #icon>
              <PhCheckCircle :size="28" />
            </template>
          </UiEmptyState>
        </UiCard>
        <div v-if="unlocked" class="drag-handle" @pointerdown="onDragHandleDown($event, 'schedule')">
          <PhDotsSix :size="14" />
        </div>
        <div v-if="unlocked" class="resize-handle" @pointerdown="onResizeHandleDown($event, 'schedule')" />
      </div>

      <div :ref="(el) => registerWidgetEl('weather', el as HTMLElement | null)" class="widget"
        :class="{ 'is-dragging': draggingId === 'weather' }"
        :style="{ ...widgetStyle(getWidget('weather')!), '--wobble-delay': '120ms' }">
        <UiCard class="home-block weather-card" :padding="false">
          <WeatherScene v-if="weather" :code="weather.code" :is-day="weather.isDay" />
          <div class="block-header">
            <span class="block-title"><PhSun :size="18" /><span class="block-title-text">Weather</span></span>
            <span v-if="weather?.location" class="weather-location-header">{{ weather.location }}</span>
          </div>
          <div v-if="weatherLoading" class="weather-body weather-body--center">
            <span class="weather-loading">Loading…</span>
          </div>
          <div v-else-if="weatherError" class="weather-body weather-body--center">
            <span class="weather-error">{{ weatherError }}</span>
          </div>
          <div v-else-if="weather" class="weather-body">
            <div class="weather-primary">
              <div class="weather-temps">
                <span class="weather-temp">{{ weather.temp }}°</span>
                <span class="weather-hilo">
                  <span class="weather-hi">H {{ weather.high }}°</span>
                  <span class="weather-sep">/</span>
                  <span class="weather-lo">L {{ weather.low }}°</span>
                </span>
              </div>
            </div>
            <div class="weather-details">
              <div class="weather-secondary">
                <span class="weather-label">{{ weatherLabel(weather.code) }}</span>
                <span class="weather-feels">Feels like {{ weather.feelsLike }}°</span>
              </div>
              <div class="weather-stats">
                <span class="weather-stat">
                  <PhDropHalf :size="13" weight="fill" class="weather-stat-icon" />
                  {{ weather.humidity }}%
                </span>
                <span class="weather-stat">
                  <PhWind :size="13" class="weather-stat-icon" />
                  {{ weather.windSpeed }} km/h
                </span>
              </div>
            </div>
          </div>
          <div v-else class="weather-body weather-body--center">
            <span class="weather-loading">No data</span>
          </div>
        </UiCard>
        <div v-if="unlocked" class="drag-handle" @pointerdown="onDragHandleDown($event, 'weather')">
          <PhDotsSix :size="14" />
        </div>
        <div v-if="unlocked" class="resize-handle" @pointerdown="onResizeHandleDown($event, 'weather')" />
      </div>

      <div :ref="(el) => registerWidgetEl('calendar', el as HTMLElement | null)" class="widget"
        :class="{ 'is-dragging': draggingId === 'calendar' }"
        :style="{ ...widgetStyle(getWidget('calendar')!), '--wobble-delay': '100ms' }">
        <UiCard class="home-block calendar-card" :padding="false">
          <div class="block-header calendar-header">
            <div class="calendar-month-nav">
              <PhCalendarBlank :size="18" class="calendar-month-nav__icon" />
              <button type="button" class="calendar-month-nav__label compact-control"
                :class="{ 'is-current': isViewingCurrentMonth }"
                :title="isViewingCurrentMonth ? monthName : 'Back to this month'"
                :aria-label="isViewingCurrentMonth ? monthName : `Back to this month, ${monthName}`"
                @click="resetCalendarMonth">
                {{ monthName }}
              </button>
              <button type="button" class="calendar-month-nav__arrow compact-control" aria-label="Previous month"
                @click="stepCalendarMonth(-1)">
                <PhCaretLeft :size="14" weight="bold" />
              </button>
              <button type="button" class="calendar-month-nav__arrow compact-control" aria-label="Next month"
                @click="stepCalendarMonth(1)">
                <PhCaretRight :size="14" weight="bold" />
              </button>
            </div>
            <div class="calendar-header-actions">
              <button type="button" class="calendar-add-btn compact-control"
                :title="`Add event on ${scheduleDateLong}`"
                :aria-label="`Add event on ${scheduleDateLong}`"
                @click="addEventFromMiniCalendar">
                <PhPlus :size="14" weight="bold" />
              </button>
              <UiButton variant="link" size="sm" class="calendar-open-btn" @click="ui.setPanel('calendar')">
                Open
                <PhArrowRight :size="13" />
              </UiButton>
            </div>
          </div>
          <div class="mini-cal" :key="monthName">
            <div class="mini-cal-weekdays">
              <span v-for="d in ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']" :key="d">{{ d }}</span>
            </div>
            <div class="mini-cal-grid">
              <button v-for="(day, i) in calendarDays" :key="i" class="mini-cal-day compact-control"
                :class="{
                  'mini-cal-day--empty': !day.date,
                  'mini-cal-day--today': isToday(day.date),
                  'mini-cal-day--weekend': isWeekend(day.date),
                }"
                :disabled="!day.date" :title="dayEventTooltip(day)" :aria-label="dayAriaLabel(day)"
                @click="day.date && ui.openCalendar(day.date)">
                <template v-if="day.date">
                  <span class="mini-cal-day__num">{{ day.n }}</span>
                  <span v-if="day.events.length" class="mini-cal-events" aria-hidden="true">
                    <span v-for="event in day.events.slice(0, 2)" :key="event.id"
                      class="mini-cal-chip" :style="miniEventStyle(event)">
                      {{ event.title }}
                    </span>
                    <span v-if="day.events.length > 2" class="mini-cal-more">
                      +{{ day.events.length - 2 }} more
                    </span>
                  </span>
                  <span v-if="day.events.length" class="mini-cal-dots" aria-hidden="true">
                    <span v-for="event in day.events.slice(0, 3)" :key="'dot-' + event.id"
                      class="event-dot" :style="{ background: eventColor(event) }" />
                    <span v-if="day.events.length > 3" class="event-dot event-dot--more" />
                  </span>
                </template>
              </button>
            </div>
          </div>
        </UiCard>
        <div v-if="unlocked" class="drag-handle" @pointerdown="onDragHandleDown($event, 'calendar')">
          <PhDotsSix :size="14" />
        </div>
        <div v-if="unlocked" class="resize-handle" @pointerdown="onResizeHandleDown($event, 'calendar')" />
      </div>

      <div :ref="(el) => registerWidgetEl('todos', el as HTMLElement | null)" class="widget"
        :class="{ 'is-dragging': draggingId === 'todos' }"
        :style="{ ...widgetStyle(getWidget('todos')!), '--wobble-delay': '340ms' }">
        <UiCard class="home-block" :padding="false">
          <div class="block-header">
            <span class="block-title"><PhListChecks :size="18" /><span class="block-title-text">To Do</span></span>
            <UiButton variant="link" size="sm" @click="ui.setPanel('tasks')">
              All
              <PhArrowRight :size="13" />
            </UiButton>
          </div>
          <div v-if="todoEntries.length" ref="todoListEl" class="todo-list">
            <template v-for="entry in visibleTodoEntries" :key="entry.key">
              <span v-if="entry.kind === 'label'" class="task-group-label">{{ entry.text }}</span>
              <div v-else class="task-row" :class="{ 'task-row--doing': entry.doing }">
                <PhCircle :size="16" weight="bold" class="task-icon" :class="{ 'task-icon--doing': entry.doing }" />
                <span class="task-title">{{ entry.task!.title }}</span>
                <span v-if="entry.task!.startAt" class="task-due"
                  :class="{ 'task-due--overdue': new Date(entry.task!.startAt) < today }">
                  {{ new Date(entry.task!.startAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) }}
                </span>
              </div>
            </template>
            <p v-if="hiddenTodoCount > 0" class="list-more">+{{ hiddenTodoCount }} more</p>
          </div>
          <UiEmptyState v-if="!todoEntries.length" class="widget-empty" message="All clear">
            <template #icon>
              <PhCheckCircle :size="28" />
            </template>
          </UiEmptyState>
        </UiCard>
        <div v-if="unlocked" class="drag-handle" @pointerdown="onDragHandleDown($event, 'todos')">
          <PhDotsSix :size="14" />
        </div>
        <div v-if="unlocked" class="resize-handle" @pointerdown="onResizeHandleDown($event, 'todos')" />
      </div>

      <div :ref="(el) => registerWidgetEl('photos', el as HTMLElement | null)" class="widget"
        :class="{ 'is-dragging': draggingId === 'photos' }"
        :style="{ ...widgetStyle(getWidget('photos')!), '--wobble-delay': '160ms' }">
        <UiCard
          class="home-block photos-card"
          :class="{ 'photos-card--live': activePhotos.length > 0 }"
          :padding="false"
        >
          <div class="block-header">
            <span class="block-title"><PhImage :size="18" /><span class="block-title-text">Photos</span></span>
          </div>
          <div v-if="activePhotos.length" class="photos-body">
            <img
              v-for="(slide, index) in photoSlides"
              :key="`bg-${slide.key}`"
              :src="slide.backdrop || slide.url"
              class="photos-backdrop"
              :class="{
                'photos-backdrop--fallback': !slide.backdrop,
                'photos-img--dissolve': slide.dissolving,
                'photos-img--outgoing': index < photoSlides.length - 1,
              }"
              decoding="async"
              draggable="false"
              alt=""
              aria-hidden="true"
            />
            <img
              v-for="(slide, index) in photoSlides"
              :key="slide.key"
              :src="slide.url"
              class="photos-img"
              :class="{
                'photos-img--dissolve': slide.dissolving,
                'photos-img--outgoing': index < photoSlides.length - 1,
              }"
              decoding="async"
              draggable="false"
            />
          </div>
          <UiEmptyState v-else class="widget-empty" message="No photos selected">
            <template #icon><PhImage :size="28" /></template>
          </UiEmptyState>
        </UiCard>
        <div v-if="unlocked" class="drag-handle" @pointerdown="onDragHandleDown($event, 'photos')">
          <PhDotsSix :size="14" />
        </div>
        <div v-if="unlocked" class="resize-handle" @pointerdown="onResizeHandleDown($event, 'photos')" />
      </div>

      <div :ref="(el) => registerWidgetEl('spotify', el as HTMLElement | null)" class="widget"
        :class="{ 'is-dragging': draggingId === 'spotify' }"
        :style="{ ...widgetStyle(getWidget('spotify')!), '--wobble-delay': '280ms' }">
        <UiCard class="home-block spotify-card" :padding="false">
          <div class="block-header">
            <span class="block-title">
              <PhMusicNote :size="18" weight="bold" /><span class="block-title-text">Spotify</span>
            </span>
            <span v-if="spotifyNeedsConfig()" class="spotify-status spotify-status--setup">Setup</span>
            <span v-else-if="!currentTrack && spotifyConnected" class="spotify-status">Ready</span>
            <span v-else-if="!currentTrack" class="spotify-status spotify-status--muted">Not connected</span>
            <span v-else class="spotify-status spotify-status--live" :class="{ 'is-paused': !currentTrack.isPlaying }">
              <span v-if="currentTrack.isPlaying" class="spotify-equalizer" aria-hidden="true">
                <span /><span /><span />
              </span>
              <span>{{ currentTrack.isPlaying ? 'Playing' : 'Paused' }}</span>
            </span>
          </div>

          <div v-if="spotifyNeedsConfig()" class="spotify-body spotify-body--center">
            <div class="spotify-setup">
              <span class="spotify-setup-badge" aria-hidden="true">
                <PhMusicNote :size="32" class="spotify-setup-icon" />
              </span>
              <p class="spotify-setup-title">Connect Spotify</p>
              <p class="spotify-setup-desc">
                Add <code>{{ spotifyRedirectUri }}</code> as a Redirect URI in your
                <a href="https://developer.spotify.com/dashboard" target="_blank">Spotify app</a>,
                then paste its Client ID:
              </p>
              <details class="spotify-setup-details">
                <summary class="spotify-setup-summary">How to set up</summary>
                <ol class="spotify-setup-steps">
                  <li>Open the <a href="https://developer.spotify.com/dashboard" target="_blank">Spotify Developer Dashboard</a> and create an app</li>
                  <li>In the app settings, add <code>{{ spotifyRedirectUri }}</code> as a Redirect URI (exact match, including the port)</li>
                  <li>In Development mode, add the Spotify account you will use under User Management</li>
                  <li>Copy the app's <strong>Client ID</strong> — not the Client Secret</li>
                </ol>
              </details>
              <div class="spotify-setup-input-row">
                <input v-model="setupClientId" class="spotify-setup-input" placeholder="Paste Client ID" @keyup.enter="submitClientId" />
                <button class="spotify-connect-btn" @click="submitClientId">Connect</button>
              </div>
              <p v-if="setupError || spotifyError" class="spotify-error">{{ setupError || spotifyError }}</p>
            </div>
          </div>

          <div v-else-if="!currentTrack" class="spotify-body spotify-body--center">
            <div class="spotify-idle">
              <div class="spotify-vinyl spotify-vinyl--idle">
                <div class="spotify-disc">
                  <div class="spotify-label-wrap spotify-label-wrap--empty">
                    <PhMusicNote :size="28" class="spotify-label-placeholder" />
                  </div>
                </div>
              </div>
              <p class="spotify-idle-text">{{ spotifyConnected ? 'Nothing playing' : 'Connect to play music' }}</p>
              <p v-if="!spotifyConnected" class="spotify-redir-hint">
                Add <code>{{ spotifyRedirectUri }}</code> to your
                <a href="https://developer.spotify.com/dashboard" target="_blank">Spotify app</a>
              </p>
              <button v-if="spotifyConnected" class="spotify-connect-btn spotify-connect-btn--small" @click="disconnectSpotify">Disconnect</button>
              <button v-else class="spotify-connect-btn" @click="connectSpotify">Connect Spotify</button>
              <p v-if="spotifyError" class="spotify-error">{{ spotifyError }}</p>
            </div>
          </div>

          <div v-else class="spotify-body spotify-body--playing">
            <div class="spotify-stage" aria-hidden="true">
              <div class="spotify-vinyl" :class="{ 'spotify-vinyl--paused': !currentTrack.isPlaying, 'spotify-vinyl--still': !settings.musicCardSpin.value }">
                <div :ref="bindVinylDisc" class="spotify-disc">
                  <div class="spotify-label-wrap" :class="{ 'spotify-label-wrap--empty': !currentTrack.albumArt }">
                    <img v-if="currentTrack.albumArt" :src="currentTrack.albumArt" class="spotify-label-art" :alt="`${currentTrack.name} album art`" />
                    <PhMusicNote v-else :size="28" class="spotify-label-placeholder" />
                  </div>
                </div>
              </div>
            </div>
            <div class="spotify-info">
              <span class="spotify-song" :title="currentTrack.name">{{ currentTrack.name }}</span>
              <span class="spotify-artist" :title="currentTrack.artists">{{ currentTrack.artists }}</span>
              <div class="spotify-progress">
                <div class="spotify-bar-track">
                  <div class="spotify-bar-fill" :style="{ transform: `scaleX(${currentTrack.durationMs ? currentTrack.progressMs / currentTrack.durationMs : 0})` }" />
                </div>
                <div class="spotify-times">
                  <span class="spotify-time">{{ formatTime(currentTrack.progressMs) }}</span>
                  <span class="spotify-time spotify-time--end">{{ formatTime(currentTrack.durationMs) }}</span>
                </div>
              </div>
            </div>
          </div>
        </UiCard>
        <div v-if="unlocked" class="drag-handle" @pointerdown="onDragHandleDown($event, 'spotify')">
          <PhDotsSix :size="14" />
        </div>
        <div v-if="unlocked" class="resize-handle" @pointerdown="onResizeHandleDown($event, 'spotify')" />
      </div>

      <div v-if="getWidget('temperatures')" :ref="(el) => registerWidgetEl('temperatures', el as HTMLElement | null)" class="widget"
        :class="{ 'is-dragging': draggingId === 'temperatures' }"
        :style="{ ...widgetStyle(getWidget('temperatures')!), '--wobble-delay': '460ms' }">
        <TemperatureCard />
        <div v-if="unlocked" class="drag-handle" @pointerdown="onDragHandleDown($event, 'temperatures')">
          <PhDotsSix :size="14" />
        </div>
        <div v-if="unlocked" class="resize-handle" @pointerdown="onResizeHandleDown($event, 'temperatures')" />
      </div>

      <div v-if="getWidget('camera')" :ref="(el) => registerWidgetEl('camera', el as HTMLElement | null)" class="widget"
        :class="{ 'is-dragging': draggingId === 'camera' }"
        :style="{ ...widgetStyle(getWidget('camera')!), '--wobble-delay': '400ms' }">
        <CameraCard />
        <div v-if="unlocked" class="drag-handle" @pointerdown="onDragHandleDown($event, 'camera')">
          <PhDotsSix :size="14" />
        </div>
        <div v-if="unlocked" class="resize-handle" @pointerdown="onResizeHandleDown($event, 'camera')" />
      </div>
    </div>

    <button ref="lockBtnEl" class="lock-toggle" :class="{ 'lock-toggle--unlocked': unlocked }" @click="toggleLock"
      :aria-label="unlocked ? 'Lock layout' : 'Unlock layout'">
      <PhLockOpen v-if="unlocked" :size="18" />
      <PhLock v-else :size="18" />
    </button>

    <Teleport to="body">
      <div v-if="blowupActive" class="card-blowup" :class="{ 'card-blowup--ready': blowupReady }" role="dialog"
        aria-modal="true" :aria-label="`${blowupLabel} card expanded`">
        <div class="card-blowup__backdrop" @click="closeBlowup" />
        <div ref="blowupStageEl" class="card-blowup__stage" />
        <button ref="blowupCloseEl" type="button" class="card-blowup__close" aria-label="Close expanded card"
          title="Close (Esc)" @click="closeBlowup">
          <PhX :size="22" weight="bold" />
        </button>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.home-view {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: clip;
  overflow-clip-margin: 6px;
}

.widget-canvas {
  position: absolute;
  inset: 0;
  display: grid;
}

.grid-cell-bg {
  border-radius: var(--radius-md);
  background: var(--color-bgSubtle);
  border: 1.5px dashed var(--color-border);
  opacity: 0;
  pointer-events: none;
  transition: opacity var(--duration-base);
}

.is-editing .grid-cell-bg {
  opacity: 0.55;
}

.widget {
  position: relative;
  z-index: 2;
  min-width: 0;
  min-height: 0;
  container-type: size;
  container-name: w;
  user-select: none;
  -webkit-user-select: none;
  -webkit-touch-callout: none;
  outline: 2px dashed transparent;
  transition: outline-color var(--duration-fast);
}

.widget :deep(input),
.widget :deep(textarea),
.widget :deep([contenteditable="true"]) {
  user-select: text;
  -webkit-user-select: text;
}

.is-editing .widget {
  border-radius: var(--radius-md);
}

.is-editing .widget:hover {
  outline-color: var(--color-borderStrong);
}

.is-editing .widget.is-dragging {
  outline-color: var(--color-primary);
  z-index: 10;
  will-change: transform;
  animation: none !important;
}

@keyframes widget-wobble {

  0%,
  100% {
    rotate: -0.35deg;
  }

  50% {
    rotate: 0.35deg;
  }
}

.is-editing .widget:not(.is-dragging) {
  transform-origin: center center;
  animation: widget-wobble 3.2s ease-in-out infinite;
  animation-delay: calc(-1 * var(--wobble-delay, 0ms));
}

.home-block {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}

.home-block :deep(.widget-empty) {
  flex: 1;
  min-height: 0;
  gap: clamp(2px, 2cqh, var(--space-3));
  padding: clamp(4px, 4cqh, var(--space-10)) var(--space-3);
  overflow: hidden;
}

.home-block :deep(.widget-empty .ui-empty__message) {
  font-size: var(--text-label-size);
  line-height: 1.3;
  text-wrap: balance;
}

@container w (max-height: 12em) {
  .home-block :deep(.widget-empty .ui-empty__icon) {
    display: none;
  }
}

.drag-handle {
  position: absolute;
  top: 8px;
  right: 8px;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-sm);
  color: var(--color-textMuted);
  cursor: grab;
  z-index: 4;
  opacity: 0;
  touch-action: none;
  transition: opacity var(--duration-fast), background var(--duration-fast);
  background: var(--color-bgSubtle);
}

.drag-handle:active {
  cursor: grabbing;
}

.is-editing .widget .drag-handle {
  opacity: 0.72;
}

.is-editing .widget:hover .drag-handle,
.is-editing .widget:focus-within .drag-handle {
  opacity: 1;
}

.resize-handle {
  position: absolute;
  bottom: 6px;
  right: 6px;
  width: 18px;
  height: 18px;
  border-radius: 3px;
  cursor: nwse-resize;
  z-index: 4;
  opacity: 0;
  touch-action: none;
  transition: opacity var(--duration-fast);
  background: var(--color-primary);
  clip-path: polygon(100% 0, 100% 100%, 0 100%);
}

.is-editing .widget .resize-handle {
  opacity: 0.7;
}

.is-editing .widget:hover .resize-handle,
.is-editing .widget:focus-within .resize-handle {
  opacity: 0.8;
}

.resize-handle:hover {
  opacity: 1 !important;
}

@media (pointer: coarse) {
  .drag-handle {
    top: 6px;
    right: 6px;
    width: 40px;
    height: 40px;
  }

  .drag-handle svg {
    width: 18px;
    height: 18px;
  }

  .resize-handle {
    bottom: 8px;
    right: 8px;
    width: 24px;
    height: 24px;
  }
}

.lock-toggle {
  position: absolute;
  bottom: var(--space-6);
  right: var(--space-6);
  z-index: 50;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  border: none;
  border-radius: var(--radius-full);
  background: linear-gradient(165deg,
      color-mix(in srgb, var(--color-bgElevated) 92%, white),
      var(--color-bgElevated),
      color-mix(in srgb, var(--color-bgElevated) 96%, black));
  color: var(--color-textSecondary);
  cursor: pointer;
  box-shadow:
    0 3px 0 0 #c0c7ca,
    0 8px 24px -4px rgba(129, 141, 146, 0.32),
    inset 0 2px 6px rgba(255, 255, 255, 0.50),
    inset 0 -2px 5px rgba(129, 141, 146, 0.15);
  transition: color var(--duration-fast), background var(--duration-fast), box-shadow var(--duration-fast);
}

.lock-toggle:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 3px;
}

.lock-toggle:hover {
  color: var(--color-textPrimary);
  box-shadow:
    0 4px 0 0 #c0c7ca,
    0 12px 32px -4px rgba(129, 141, 146, 0.38),
    inset 0 2px 6px rgba(255, 255, 255, 0.55),
    inset 0 -2px 5px rgba(129, 141, 146, 0.18);
}

.lock-toggle--unlocked {
  background: linear-gradient(165deg,
      color-mix(in srgb, var(--color-primary) 88%, white),
      var(--color-primary) 55%,
      color-mix(in srgb, var(--color-primary) 93%, black));
  color: #fafafa;
  box-shadow:
    0 3px 0 0 var(--color-primaryDark),
    0 8px 24px -4px var(--shadow-accent-drop),
    inset 0 2px 6px rgba(255, 255, 255, 0.22),
    inset 0 -2px 5px rgba(0, 0, 0, 0.18);
}

.lock-toggle--unlocked:hover {
  box-shadow:
    0 4px 0 0 var(--color-primaryDark),
    0 12px 32px -4px var(--shadow-accent-drop),
    inset 0 2px 6px rgba(255, 255, 255, 0.25),
    inset 0 -2px 5px rgba(0, 0, 0, 0.22);
}

:global(.dark) .lock-toggle {
  box-shadow:
    0 3px 0 0 #1e2527,
    0 8px 24px -4px rgba(0, 0, 0, 0.40),
    inset 0 2px 6px rgba(255, 255, 255, 0.06),
    inset 0 -2px 5px rgba(0, 0, 0, 0.25);
}

:global(.dark) .lock-toggle:hover {
  box-shadow:
    0 4px 0 0 #1e2527,
    0 12px 32px -4px rgba(0, 0, 0, 0.48),
    inset 0 2px 6px rgba(255, 255, 255, 0.08),
    inset 0 -2px 5px rgba(0, 0, 0, 0.28);
}

:global(.dark) .lock-toggle--unlocked {
  color: var(--color-textInverse);
  box-shadow:
    0 3px 0 0 var(--color-primaryDark),
    0 8px 24px -4px var(--shadow-accent-drop),
    inset 0 2px 6px rgba(255, 255, 255, 0.10),
    inset 0 -2px 5px rgba(0, 0, 0, 0.30);
}

:global(.dark) .lock-toggle--unlocked:hover {
  box-shadow:
    0 4px 0 0 var(--color-primaryDark),
    0 12px 32px -4px var(--shadow-accent-drop),
    inset 0 2px 6px rgba(255, 255, 255, 0.12),
    inset 0 -2px 5px rgba(0, 0, 0, 0.35);
}

.photos-card {
  position: relative;
}

.photos-card--live::after {
  content: "";
  position: absolute;
  inset: 0 0 auto;
  height: clamp(36px, 26cqh, 88px);
  z-index: 1;
  pointer-events: none;
  background: linear-gradient(
    180deg,
    color-mix(in srgb, var(--color-bgSurface) 88%, transparent),
    transparent
  );
}

.photos-card > .block-header {
  position: relative;
  z-index: 2;
}

.photos-body {
  position: absolute;
  inset: 0;
  z-index: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  min-height: 0;
  background: var(--color-bgSubtle);
}

.photos-backdrop {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  transform: scale(1.12);
  pointer-events: none;
}

.photos-backdrop--fallback {
  filter: blur(28px) saturate(1.15) brightness(0.55);
}

.photos-img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  position: absolute;
  inset: 0;
  z-index: 1;
}

.photos-img--dissolve {
  animation: photo-dissolve 2s ease-in-out both;
  will-change: opacity;
}

.photos-img--outgoing {
  animation: photo-fade-out 2s ease-in-out both;
  pointer-events: none;
}

@keyframes photo-dissolve {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes photo-fade-out {
  from { opacity: 1; }
  to { opacity: 0; }
}

.block-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  flex: 0 0 auto;
  min-width: 0;
  padding: var(--space-3) var(--space-4) 0;
  margin-bottom: var(--space-3);
}

.block-title {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
  font-family: var(--font-display, var(--font-family));
  font-size: var(--text-label-size);
  font-weight: 600;
  letter-spacing: 0.1em;
  line-height: 1.3;
  text-transform: uppercase;
  color: var(--color-textSecondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.block-title svg {
  flex-shrink: 0;
  color: var(--color-textMuted);
}

.datetime-card .block-title svg,
.spotify-card .block-title svg {
  color: var(--color-primaryDark);
}

.weather-card .block-title svg {
  color: var(--color-info);
}

.block-title-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.block-header :deep(.ui-btn--sm) {
  flex-shrink: 0;
  padding: 2px var(--space-2);
}

.block-header :deep(.ui-btn--sm .ui-btn__inner) {
  gap: 2px;
  font-size: var(--text-label-size);
}

@container w (max-width: 16em) {
  .block-header :deep(.ui-btn--sm) {
    display: none;
  }
}

.house-card {
  --hero-tint: var(--color-primary);
}

.house-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: clamp(5px, 2cqh, var(--space-4));
  padding: 0 clamp(10px, 2.6cqw, var(--space-6)) clamp(8px, 2.4cqh, var(--space-4));
  overflow: hidden;
}

.house-time {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: clamp(2px, 1cqh, var(--space-2));
  min-width: 0;
  max-width: 100%;
  text-align: center;
}

.datetime-time {
  display: flex;
  align-items: flex-start;
  justify-content: center;
  gap: clamp(3px, 1.2cqw, var(--space-3));
  max-width: 100%;
  min-width: 0;
  font-family: var(--font-display, var(--font-family));
  color: var(--color-textPrimary);
  white-space: nowrap;
}

.datetime-clock {
  font-size: clamp(30px, min(20cqh, 18cqw), 96px);
  font-weight: 600;
  line-height: 0.92;
  letter-spacing: -0.025em;
  font-variant-numeric: tabular-nums;
}

.datetime-clock-side {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 1px;
  padding-top: 0.16em;
  font-size: clamp(11px, 5.4cqh, 22px);
  font-weight: 600;
  line-height: 1;
  letter-spacing: 0.08em;
  color: var(--color-textSecondary);
  font-variant-numeric: tabular-nums;
}

.datetime-period {
  text-transform: uppercase;
  color: var(--color-primaryDark);
}

.datetime-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: clamp(2px, 1cqh, var(--space-1)) clamp(6px, 1.4cqw, var(--space-3));
  max-width: 100%;
  min-width: 0;
}

.datetime-house,
.datetime-date {
  max-width: 100%;
  min-width: 0;
  margin: 0;
  line-height: 1.3;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.datetime-house {
  font-family: var(--font-display, var(--font-family));
  font-size: clamp(var(--text-micro-size), 3.8cqh, var(--text-label-size));
  font-weight: 600;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--color-primaryDark);
}

.datetime-date {
  font-size: clamp(var(--text-micro-size), 4.2cqh, var(--text-body-size));
  color: var(--color-textSecondary);
}

.datetime-date::before {
  content: "";
  display: inline-block;
  width: 4px;
  height: 4px;
  margin-right: clamp(4px, 1cqw, var(--space-2));
  border-radius: 50%;
  background: color-mix(in srgb, var(--color-textMuted) 60%, transparent);
  vertical-align: middle;
}

.house-wifi {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: clamp(3px, 1cqh, 6px);
  flex-shrink: 0;
  max-width: 100%;
  min-width: 0;
}

.house-wifi__code {
  display: block;
  width: clamp(72px, min(72cqw, 56cqh), 280px);
  max-width: 100%;
  aspect-ratio: 1;
}

.house-wifi__label {
  font-size: var(--text-micro-size);
  font-weight: 600;
  letter-spacing: 0.04em;
  line-height: 1;
  color: var(--color-textMuted);
}

@container w (max-width: 12em) {
  .datetime-clock {
    font-size: clamp(20px, 14cqw, 64px);
  }

  .datetime-clock-side {
    font-size: clamp(9px, 4cqw, 16px);
  }

  .datetime-date::before {
    display: none;
  }

  .datetime-meta {
    flex-direction: column;
    gap: 0;
  }
}

@container w (max-width: 9em) {
  .datetime-clock {
    font-size: clamp(18px, 13cqw, 48px);
  }
}

@container w (max-height: 8em) {
  .house-wifi__label {
    display: none;
  }
}

@container w (max-height: 12em) {
  .house-body {
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
    column-gap: clamp(8px, 2.4cqw, var(--space-4));
  }

  .house-time {
    flex: 1;
    align-items: flex-start;
    text-align: left;
  }

  .house-wifi {
    flex-shrink: 0;
  }

  .house-wifi__code {
    width: clamp(64px, min(40cqw, 62cqh), 220px);
  }

  .house-wifi__label {
    letter-spacing: 0.1em;
  }

  .datetime-house {
    display: none;
  }

  .datetime-date::before {
    display: none;
  }
}

@container w (max-height: 12em) and (min-width: 32em) {
  .house-wifi__code {
    width: clamp(96px, min(24cqw, 64cqh), 240px);
  }

  .datetime-clock {
    font-size: clamp(32px, min(42cqh, 16cqw), 76px);
  }

  .datetime-clock-side {
    font-size: clamp(11px, 14cqh, 22px);
  }
}

@container w (min-height: 12em) and (max-height: 14.5em) and (max-width: 25.9em) {
  .datetime-meta {
    display: none;
  }

  .house-wifi__code {
    width: clamp(72px, min(72cqw, 48cqh), 200px);
  }
}

@container w (min-height: 14.5em) and (max-height: 22em) and (max-width: 25.9em) {
  .datetime-house {
    display: none;
  }

  .house-wifi__code {
    width: clamp(72px, min(72cqw, 50cqh), 220px);
  }
}

@container w (min-width: 26em) and (min-height: 12em) {
  .house-body {
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
    column-gap: clamp(12px, 3cqw, var(--space-6));
    padding-inline: clamp(12px, 3cqw, var(--space-6));
  }

  .house-time {
    align-items: flex-start;
    text-align: left;
  }

  .house-wifi {
    flex-shrink: 0;
  }

  .house-wifi__code {
    width: clamp(96px, min(34cqw, 60cqh), 280px);
  }

  .datetime-time {
    justify-content: flex-start;
  }

  .datetime-clock {
    font-size: clamp(32px, min(28cqh, 13cqw), 96px);
  }

  .datetime-clock-side {
    font-size: clamp(12px, min(6.5cqh, 2.4cqw), 24px);
  }

  .datetime-meta {
    justify-content: flex-start;
  }

  .datetime-date::before {
    display: none;
  }
}

@container w (min-width: 32em) and (min-height: 20em) {
  .house-body {
    gap: clamp(8px, 2.2cqh, var(--space-5));
  }

  .datetime-clock {
    font-size: clamp(56px, min(30cqh, 14cqw), 132px);
  }

  .datetime-clock-side {
    font-size: clamp(14px, min(7.5cqh, 2.6cqw), 30px);
  }

  .house-wifi__label {
    font-size: var(--text-label-size);
  }
}

.weather-card {
  --hero-tint: var(--color-info);
  position: relative;
}

.weather-card > .block-header,
.weather-card > .weather-body {
  position: relative;
  z-index: 1;
}

.weather-location-header {
  flex-shrink: 1;
  min-width: 0;
  max-width: 48%;
  margin-left: auto;
  padding: 2px clamp(6px, 1.2cqw, var(--space-2));
  border-radius: var(--radius-full);
  background: color-mix(in srgb, var(--hero-tint) 12%, transparent);
  font-size: var(--text-micro-size);
  font-weight: var(--font-weight-medium);
  color: var(--color-textSecondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.weather-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: clamp(4px, 2cqh, var(--space-3));
  padding: 0 clamp(8px, 3cqw, var(--space-6)) clamp(6px, 2cqh, var(--space-3));
  overflow: hidden;
  text-align: center;
}

.weather-body--center {
  align-items: center;
}

.weather-primary {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: clamp(8px, 2.4cqw, var(--space-4));
  max-width: 100%;
  min-height: 0;
}

.weather-temps {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: clamp(2px, 0.8cqh, var(--space-1));
  min-width: 0;
}

.weather-temp {
  font-family: var(--font-display, var(--font-family));
  font-size: clamp(30px, 28cqh, 88px);
  font-weight: 600;
  line-height: 0.9;
  letter-spacing: -0.03em;
  color: var(--color-textPrimary);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.weather-hilo {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  padding: 1px clamp(6px, 1.2cqw, var(--space-2));
  border-radius: var(--radius-full);
  background: var(--color-bgSubtle);
  font-size: var(--text-micro-size);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.weather-hi {
  color: var(--color-textPrimary);
  font-weight: var(--font-weight-medium);
}

.weather-sep {
  color: var(--color-textMuted);
}

.weather-lo {
  color: var(--color-textMuted);
}

.weather-details {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: clamp(3px, 1.2cqh, var(--space-2));
  min-width: 0;
  max-width: 100%;
}

.weather-secondary {
  display: flex;
  align-items: baseline;
  justify-content: center;
  gap: var(--space-2);
  flex-wrap: wrap;
  min-width: 0;
}

.weather-label {
  padding: 1px clamp(7px, 1.4cqw, var(--space-2));
  border-radius: var(--radius-full);
  background: color-mix(in srgb, var(--hero-tint) 14%, transparent);
  font-size: var(--text-label-size);
  font-weight: var(--font-weight-medium);
  color: var(--color-textPrimary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.weather-feels {
  font-size: var(--text-micro-size);
  color: var(--color-textMuted);
  white-space: nowrap;
}

.weather-stats {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: clamp(4px, 1.2cqw, var(--space-2));
  flex-wrap: wrap;
}

.weather-stat {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 2px clamp(6px, 1.2cqw, var(--space-2));
  border-radius: var(--radius-full);
  background: var(--color-bgSubtle);
  font-size: var(--text-micro-size);
  color: var(--color-textSecondary);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.weather-stat-icon {
  color: var(--color-info);
  opacity: 0.9;
}

.weather-loading,
.weather-error {
  font-size: var(--text-body-size);
  color: var(--color-textMuted);
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
}

.weather-error {
  color: var(--color-danger);
}

@container w (min-width: 24em) and (min-height: 9em) {
  .weather-body {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    grid-template-areas: "primary details";
    align-content: center;
    align-items: center;
    justify-items: start;
    text-align: left;
    column-gap: clamp(12px, 3.4cqw, var(--space-8));
  }

  .weather-primary {
    grid-area: primary;
    justify-content: flex-start;
  }

  .weather-details {
    grid-area: details;
    align-items: flex-start;
    padding-left: clamp(12px, 2.8cqw, var(--space-6));
    border-left: 2px solid color-mix(in srgb, var(--hero-tint) 26%, transparent);
  }

  .weather-secondary,
  .weather-stats {
    justify-content: flex-start;
  }
}

@container w (max-height: 10em) {
  .weather-body {
    flex-direction: row;
    flex-wrap: nowrap;
    justify-content: center;
    gap: clamp(8px, 2cqw, var(--space-4));
    padding-bottom: 4px;
  }

  .weather-primary {
    flex-shrink: 0;
  }

  .weather-details {
    flex-direction: column;
    align-items: flex-start;
    justify-content: center;
    gap: 2px;
    text-align: left;
    min-width: 0;
  }

  .weather-stats {
    display: none;
  }

  .weather-feels {
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
  }
}

@container w (max-height: 7.5em) {
  .weather-feels {
    display: none;
  }

  .weather-temp {
    font-size: clamp(24px, 24cqh, 52px);
  }

  .weather-label {
    font-size: var(--text-micro-size);
  }
}

@container w (max-width: 12em) and (max-height: 10em) {
  .weather-secondary {
    display: none;
  }
}

@container w (max-width: 14em) {
  .weather-details {
    align-items: center;
  }

  .weather-secondary {
    justify-content: center;
    flex-wrap: wrap;
  }

  .weather-label,
  .weather-feels {
    min-width: 0;
  }
}

.schedule-nav {
  display: flex;
  align-items: stretch;
  flex-shrink: 0;
  gap: 2px;
  margin: 0 var(--space-4) var(--space-2);
  padding: 3px;
  border-radius: var(--radius-full);
  background: var(--color-bgSubtle);
}

.schedule-nav__arrow {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: center;
  width: clamp(24px, 7cqw, 32px);
  border: none;
  border-radius: var(--radius-full);
  background: transparent;
  color: var(--color-textMuted);
  cursor: pointer;
  transition: background var(--duration-fast), color var(--duration-fast), transform var(--duration-fast);
}

.schedule-nav__arrow:hover {
  background: var(--color-bgElevated);
  color: var(--color-textPrimary);
}

.schedule-nav__arrow:active {
  transform: scale(0.92);
}

.schedule-nav__arrow:focus-visible,
.schedule-nav__active:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 1px;
}

.schedule-nav__active {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: clamp(3px, 1cqw, 6px);
  padding: clamp(2px, 1cqh, 5px) var(--space-2);
  border: none;
  border-radius: var(--radius-full);
  background: transparent;
  font-family: var(--font-family);
  color: var(--color-textPrimary);
  cursor: pointer;
  transition: background var(--duration-fast);
}

.schedule-nav__active:hover {
  background: var(--color-bgElevated);
}

.schedule-nav__label {
  font-size: var(--text-label-size);
  font-weight: var(--font-weight-medium);
  line-height: 1.2;
  white-space: nowrap;
}

.schedule-nav__date {
  min-width: 0;
  font-size: var(--text-micro-size);
  line-height: 1.2;
  color: var(--color-textMuted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.schedule-nav__date::before {
  content: "·";
  padding-right: clamp(2px, 0.8cqw, 5px);
  color: var(--color-borderStrong);
}

.schedule-list {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 0 0 var(--space-1);
  overflow: hidden;
}

.schedule-row {
  display: flex;
  align-items: center;
  gap: clamp(4px, 1.2cqw, var(--space-2));
  width: 100%;
  padding: var(--space-1) var(--space-3);
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  font-family: var(--font-family);
  text-align: left;
  cursor: pointer;
  flex-shrink: 0;
  transition: background var(--duration-fast), transform var(--duration-fast);
}

.schedule-row:active {
  transform: scale(0.995);
  transition-duration: 60ms;
}

.schedule-row:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: -2px;
}

.schedule-row:hover {
  background: var(--color-bgSubtle);
}

.schedule-dot {
  flex-shrink: 0;
  width: clamp(5px, 1.4cqw, 7px);
  aspect-ratio: 1;
  border-radius: 50%;
}

.schedule-time {
  flex-shrink: 0;
  font-size: var(--text-label-size);
  color: var(--color-textMuted);
  font-variant-numeric: tabular-nums;
  width: auto;
  min-width: calc(var(--text-label-size) * 4.4);
  white-space: nowrap;
}

.schedule-time--allday {
  font-size: var(--text-micro-size);
  font-weight: var(--font-weight-medium);
  color: var(--color-textSecondary);
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.schedule-title {
  flex: 1;
  min-width: 0;
  font-size: var(--text-body-size);
  color: var(--color-textPrimary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.schedule-assignee {
  flex-shrink: 0;
  max-width: 30%;
  font-size: var(--text-label-size);
  color: var(--color-textMuted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.schedule-now {
  flex-shrink: 0;
  padding: 1px clamp(4px, 1cqw, 7px);
  border-radius: var(--radius-full);
  background: color-mix(in srgb, var(--color-primary) 22%, transparent);
  color: var(--color-textPrimary);
  font-size: var(--text-micro-size);
  font-weight: var(--font-weight-medium);
  letter-spacing: 0.04em;
  line-height: 1.4;
  text-transform: uppercase;
}

.schedule-row--now {
  background: color-mix(in srgb, var(--color-primary) 10%, transparent);
}

.schedule-row--now:hover {
  background: color-mix(in srgb, var(--color-primary) 16%, transparent);
}

.schedule-row--past .schedule-title,
.schedule-row--past .schedule-time,
.schedule-row--past .schedule-assignee {
  opacity: 0.5;
}

.schedule-row--past .schedule-dot {
  opacity: 0.35;
}

.list-more {
  flex-shrink: 0;
  padding: 2px var(--space-3);
  font-size: var(--text-micro-size);
  line-height: 1.3;
  color: var(--color-textMuted);
  text-align: right;
  white-space: nowrap;
}

@container w (max-width: 16em) {
  .schedule-assignee,
  .task-due {
    display: none;
  }

  .schedule-time {
    min-width: 0;
  }
}

@container w (max-width: 12em) {
  .schedule-nav {
    margin-inline: var(--space-2);
  }

  .schedule-nav__date {
    display: none;
  }
}

@container w (max-height: 9em) {
  .schedule-nav {
    margin-bottom: var(--space-1);
  }

  .schedule-row,
  .task-row {
    padding-block: 2px;
  }
}

.calendar-header-actions {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-shrink: 0;
}

.calendar-add-btn {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-full);
  background: var(--color-bgSubtle);
  color: var(--color-textSecondary);
  cursor: pointer;
  transition:
    background var(--duration-fast),
    border-color var(--duration-fast),
    color var(--duration-fast),
    transform var(--duration-fast);
}

.calendar-add-btn::after {
  content: "";
  position: absolute;
  inset: -10px;
}

.calendar-add-btn:hover {
  background: var(--color-accent-lighter);
  border-color: var(--color-accent-darker);
  color: var(--color-accent-darker);
}

.calendar-add-btn:active {
  transform: scale(0.92);
}

.calendar-add-btn:focus-visible {
  outline: 2px solid var(--color-accent-darker);
  outline-offset: 2px;
}

.calendar-month-nav {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
}

.calendar-month-nav__icon {
  flex-shrink: 0;
  color: var(--color-textMuted);
}

.calendar-month-nav__arrow {
  position: relative;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border: none;
  border-radius: var(--radius-full);
  background: transparent;
  color: var(--color-textMuted);
  cursor: pointer;
  transition: background var(--duration-fast), color var(--duration-fast), transform var(--duration-fast);
}

.calendar-month-nav__arrow::after {
  content: "";
  position: absolute;
  inset: -14px -2px;
}

.calendar-month-nav__arrow:hover {
  background: var(--color-bgSubtle);
  color: var(--color-textPrimary);
}

.calendar-month-nav__arrow:active {
  transform: scale(0.92);
}

.calendar-month-nav__label {
  position: relative;
  min-width: 0;
  margin-block: -12px;
  padding: 12px var(--space-1);
  border: none;
  border-radius: var(--radius-xs);
  background: transparent;
  background-clip: content-box;
  font-family: var(--font-display, var(--font-family));
  font-size: var(--text-label-size);
  font-weight: 600;
  letter-spacing: 0.1em;
  line-height: 1.3;
  text-transform: uppercase;
  color: var(--color-textSecondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  cursor: pointer;
  transition: background var(--duration-fast), color var(--duration-fast);
}

.calendar-month-nav__label:hover {
  background: var(--color-bgSubtle);
  color: var(--color-textPrimary);
}

.calendar-month-nav__label.is-current {
  cursor: default;
}

.calendar-month-nav__label.is-current:hover {
  background: transparent;
  color: var(--color-textSecondary);
}

.calendar-month-nav__arrow:focus-visible,
.calendar-month-nav__label:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 1px;
}

.mini-cal {
  padding: 0 var(--space-3) var(--space-2);
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  animation: mini-cal-in var(--duration-base) ease;
}

@keyframes mini-cal-in {
  from { opacity: 0.35; }
  to   { opacity: 1; }
}

.mini-cal-weekdays {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: clamp(1px, 0.5cqh, 4px);
  flex-shrink: 0;
  margin-bottom: clamp(2px, 0.6cqh, 5px);
  padding-bottom: clamp(2px, 0.6cqh, 5px);
  border-bottom: 1px solid color-mix(in srgb, var(--color-border) 65%, transparent);
}

.mini-cal-weekdays span {
  text-align: center;
  font-size: var(--text-micro-size);
  font-weight: var(--font-weight-medium);
  color: var(--color-textMuted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  line-height: 1.2;
}

.mini-cal-grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  grid-auto-rows: minmax(0, 1fr);
  gap: clamp(1px, 0.5cqh, 4px);
  flex: 1;
  min-height: 0;
}

.mini-cal-day {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  border: none;
  background: none;
  border-radius: var(--radius-xs);
  font-size: clamp(9px, 2.6cqh, var(--text-label-size));
  color: var(--color-textSecondary);
  cursor: pointer;
  min-width: unset;
  min-height: unset;
  padding: 0;
  line-height: 1;
  overflow: hidden;
  transition: background var(--duration-fast), color var(--duration-fast);
}

.mini-cal-day__num {
  display: block;
  font-variant-numeric: tabular-nums;
}

.mini-cal-day--weekend:not(.mini-cal-day--today) {
  color: var(--color-textMuted);
}

.mini-cal-day:hover:not(:disabled):not(.mini-cal-day--today) {
  background: var(--color-bgSubtle);
}

.mini-cal-day--empty {
  cursor: default;
}

.mini-cal-day--today {
  background: var(--color-primary);
  color: var(--color-textInverse);
  font-weight: var(--font-weight-medium);
}

.mini-cal-events {
  display: none;
}

.mini-cal-more,
.mini-cal-dots {
  pointer-events: none;
}

.mini-cal-dots {
  position: absolute;
  bottom: clamp(2px, 0.6cqh, 4px);
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 2px;
}

.event-dot {
  width: clamp(3px, 0.5cqh, var(--space-2));
  height: clamp(3px, 0.5cqh, var(--space-2));
  border-radius: 50%;
  background: var(--color-primary);
  opacity: 0.8;
}

.event-dot--more {
  background: var(--color-textMuted);
  opacity: 0.55;
}

.mini-cal-day--today .event-dot {
  box-shadow: 0 0 0 1px var(--color-textInverse);
}

@container w (min-width: 20em) and (min-height: 18em) {
  .mini-cal-day {
    align-items: stretch;
    justify-content: flex-start;
    gap: clamp(1px, 0.4cqh, 3px);
    padding: clamp(2px, 0.7cqh, 5px);
    text-align: left;
    font-size: clamp(10px, 2.2cqh, var(--text-label-size));
  }

  .mini-cal-day__num {
    align-self: flex-start;
    font-weight: var(--font-weight-medium);
    line-height: 1.1;
    color: var(--color-textPrimary);
  }

  .mini-cal-day--weekend .mini-cal-day__num {
    color: var(--color-textSecondary);
  }

  .mini-cal-day:hover:not(:disabled) {
    background: var(--color-bgSubtle);
  }

  .mini-cal-day--today {
    background: color-mix(in srgb, var(--color-primary) 14%, transparent);
    color: var(--color-textPrimary);
  }

  .mini-cal-day--today:hover {
    background: color-mix(in srgb, var(--color-primary) 20%, transparent);
  }

  .mini-cal-day--today .mini-cal-day__num {
    display: grid;
    place-items: center;
    min-width: 1.7em;
    height: 1.7em;
    padding: 0 3px;
    border-radius: var(--radius-full);
    background: var(--color-primary);
    color: var(--color-textInverse);
  }

  .mini-cal-events {
    display: flex;
    flex-direction: column;
    gap: 1px;
    width: 100%;
    min-height: 0;
    overflow: hidden;
  }

  .mini-cal-chip {
    flex-shrink: 0;
    display: block;
    padding: 0 clamp(2px, 0.6cqw, 4px);
    border-left: 2px solid var(--mini-event-color, var(--color-primary));
    border-radius: 2px;
    background: color-mix(in srgb, var(--mini-event-color, var(--color-primary)) 26%, transparent);
    font-size: clamp(9px, 1.7cqh, 10px);
    line-height: 1.3;
    color: var(--color-textPrimary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .mini-cal-day--today .mini-cal-chip {
    background: color-mix(in srgb, var(--mini-event-color, var(--color-primary)) 34%, transparent);
  }

  .mini-cal-more {
    flex-shrink: 0;
    font-size: clamp(7px, 1.4cqh, 9px);
    line-height: 1.2;
    color: var(--color-textMuted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .mini-cal-dots {
    display: none;
  }
}

@container w (max-width: 20em) {
  .calendar-header :deep(.ui-btn--sm),
  .calendar-add-btn {
    display: none;
  }
}

@container w (max-height: 12em) {
  .mini-cal-weekdays {
    display: none;
  }

  .mini-cal {
    padding-bottom: var(--space-1);
  }
}

@container w (max-width: 16em) {
  .mini-cal-weekdays span {
    letter-spacing: 0;
  }

  .calendar-month-nav__icon {
    display: none;
  }
}

@container w (max-height: 7em) {
  .mini-cal-weekdays,
  .mini-cal-grid {
    display: none;
  }

  .mini-cal {
    padding-bottom: var(--space-1);
  }
}

.todo-list {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 0 0 var(--space-1);
  overflow: hidden;
}

.task-group-label {
  flex-shrink: 0;
  padding: 2px var(--space-3) 0;
  font-size: var(--text-micro-size);
  font-weight: var(--font-weight-medium);
  line-height: 1.3;
  color: var(--color-textMuted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.task-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-1) var(--space-3);
  border-radius: var(--radius-sm);
  flex-shrink: 0;
  transition: background var(--duration-fast);
}

.task-row:hover {
  background: var(--color-bgSubtle);
}

.task-row--doing .task-title {
  font-weight: var(--font-weight-medium);
}

.task-icon {
  flex-shrink: 0;
  color: var(--color-border);
}

.task-icon--doing {
  color: var(--color-warning);
}

.task-title {
  flex: 1;
  min-width: 0;
  font-size: var(--text-body-size);
  color: var(--color-textPrimary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.task-due {
  flex-shrink: 0;
  font-size: var(--text-label-size);
  color: var(--color-textMuted);
  white-space: nowrap;
}

.task-due--overdue {
  color: var(--color-error);
}

.spotify-card {
  --hero-tint: var(--color-primary);
  min-height: 0;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

@keyframes equalizer {
  0%, 100% { height: 3px; }
  50% { height: 11px; }
}

.spotify-status {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  flex-shrink: 0;
  max-width: 52%;
  padding: 2px clamp(6px, 1.2cqw, var(--space-2));
  border-radius: var(--radius-full);
  background: var(--color-bgSubtle);
  color: var(--color-textSecondary);
  font-family: var(--font-display, var(--font-family));
  font-size: var(--text-micro-size);
  font-weight: 600;
  letter-spacing: 0.06em;
  line-height: 1.5;
  text-transform: uppercase;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.spotify-status--live {
  background: var(--color-primary);
  color: var(--color-on-accent, var(--color-textInverse));
}

.spotify-status--live.is-paused {
  background: var(--color-bgSubtle);
  color: var(--color-textSecondary);
}

.spotify-status--setup {
  background: color-mix(in srgb, var(--color-primary) 16%, transparent);
  color: var(--color-primaryDark);
}

.spotify-status--muted {
  color: var(--color-textMuted);
}

.spotify-equalizer {
  display: flex;
  align-items: flex-end;
  gap: 2px;
  height: 12px;
}

.spotify-equalizer span {
  display: block;
  width: 2px;
  height: 6px;
  border-radius: 2px;
  background: currentColor;
  animation: equalizer 0.6s ease-in-out infinite alternate;
}

.spotify-equalizer span:nth-child(2) {
  animation-delay: 0.2s;
  height: 10px;
}

.spotify-equalizer span:nth-child(3) {
  animation-delay: 0.4s;
}

.spotify-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: clamp(4px, 2cqh, var(--space-3));
  padding: 0 var(--space-3) clamp(4px, 2cqh, var(--space-3));
  min-height: 0;
  overflow: hidden;
}

.spotify-body--center {
  justify-content: center;
}

.spotify-body--playing {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  justify-content: flex-start;
  gap: 0;
  padding: 0;
  overflow: hidden;
}

.spotify-stage {
  position: relative;
  display: flex;
  flex: 1 1 auto;
  align-items: center;
  justify-content: center;
  width: 100%;
  min-height: 0;
  padding: clamp(8px, 2.4cqh, var(--space-4));
  overflow: hidden;
  background:
    radial-gradient(circle at 50% 44%, color-mix(in srgb, var(--hero-tint) 20%, transparent), transparent 68%),
    linear-gradient(
      180deg,
      color-mix(in srgb, var(--hero-tint) 7%, var(--color-bgSurface)),
      color-mix(in srgb, var(--hero-tint) 3%, var(--color-bgSurface))
    );
}

.spotify-vinyl {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: min(56cqh, 78cqw, 320px);
  max-width: 100%;
  max-height: 100%;
  aspect-ratio: 1;
}

.spotify-vinyl--paused {
  opacity: 0.82;
}

.spotify-vinyl--idle {
  opacity: 0.5;
}

.spotify-disc {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  border-radius: 50%;
  background:
    repeating-radial-gradient(
      circle at center,
      transparent 0 1px,
      rgba(255, 255, 255, 0.035) 1px 2px
    ),
    radial-gradient(circle at 32% 26%, #414141, #161616 58%, #070707 100%);
  box-shadow:
    0 12px 28px -10px rgba(0, 0, 0, 0.55),
    inset 0 1px 2px rgba(255, 255, 255, 0.14),
    inset 0 -12px 24px rgba(0, 0, 0, 0.45);
  animation: spin var(--vinyl-spin-duration, 20s) linear infinite;
  animation-play-state: paused;
}

.spotify-disc::before {
  content: "";
  position: absolute;
  inset: 3%;
  border-radius: 50%;
  background: repeating-radial-gradient(
    circle at center,
    transparent 0 2px,
    rgba(255, 255, 255, 0.018) 2px 3px
  );
  pointer-events: none;
}

.spotify-vinyl:not(.spotify-vinyl--paused):not(.spotify-vinyl--idle):not(.spotify-vinyl--still) .spotify-disc {
  animation-play-state: running;
}

.spotify-label-wrap {
  position: relative;
  z-index: 1;
  width: 52%;
  aspect-ratio: 1;
  border-radius: 50%;
  overflow: hidden;
  background: #1c1c1c;
  box-shadow:
    inset 0 0 10px rgba(0, 0, 0, 0.55),
    0 0 0 3px rgba(255, 255, 255, 0.1);
}

.spotify-label-wrap--empty {
  display: flex;
  align-items: center;
  justify-content: center;
}

.spotify-label-art {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.spotify-label-placeholder {
  color: var(--color-textMuted);
  opacity: 0.7;
}

.spotify-info {
  display: flex;
  flex: 0 0 auto;
  flex-direction: column;
  gap: 2px;
  width: 100%;
  min-width: 0;
  padding: clamp(6px, 1.4cqh, var(--space-2)) var(--space-3) clamp(6px, 1.6cqh, var(--space-3));
  text-align: left;
  background: var(--color-bgSurface);
  border-top: 1px solid color-mix(in srgb, var(--color-border) 70%, transparent);
}

.spotify-song {
  display: -webkit-box;
  font-family: var(--font-display, var(--font-family));
  font-size: clamp(var(--text-body-size), 4.2cqh, var(--text-title-size));
  font-weight: 600;
  line-height: 1.25;
  color: var(--color-textPrimary);
  overflow: hidden;
  overflow-wrap: anywhere;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.spotify-artist {
  font-size: var(--text-label-size);
  line-height: 1.3;
  color: var(--color-textSecondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.spotify-progress {
  display: flex;
  flex-direction: column;
  gap: 2px;
  width: 100%;
  margin-top: var(--space-1);
}

.spotify-bar-track {
  width: 100%;
  height: 5px;
  background: var(--color-bgSubtle);
  border-radius: var(--radius-full);
  overflow: hidden;
}

.spotify-bar-fill {
  width: 100%;
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(
    90deg,
    color-mix(in srgb, var(--color-primary) 70%, transparent),
    var(--color-primary)
  );
  transform-origin: left center;
  transition: transform 0.3s linear;
}

.spotify-times {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
}

.spotify-time {
  flex-shrink: 0;
  font-size: var(--text-micro-size);
  font-variant-numeric: tabular-nums;
  color: var(--color-textMuted);
}

.spotify-time--end {
  text-align: right;
}

.spotify-setup {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) 0;
  width: 100%;
  max-width: 100%;
  min-width: 0;
}

.spotify-setup-badge {
  display: grid;
  place-items: center;
  width: clamp(44px, 20cqh, 64px);
  aspect-ratio: 1;
  border-radius: 50%;
  background: color-mix(in srgb, var(--hero-tint) 12%, var(--color-bgSurface));
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--hero-tint) 28%, transparent);
}

.spotify-setup-icon {
  color: var(--color-primaryDark);
  opacity: 0.9;
}

.spotify-setup-title {
  font-family: var(--font-display, var(--font-family));
  font-size: var(--text-body-size);
  font-weight: 600;
  color: var(--color-textPrimary);
}

.spotify-setup-desc {
  font-size: var(--text-micro-size);
  color: var(--color-textMuted);
  text-align: center;
}

.spotify-setup-desc code {
  background: var(--color-bgSubtle);
  padding: 1px 4px;
  border-radius: 3px;
  font-size: inherit;
}

.spotify-setup-details {
  width: 100%;
  font-size: var(--text-micro-size);
}

.spotify-setup-summary {
  cursor: pointer;
  color: var(--color-primary);
  text-align: center;
  font-weight: var(--font-weight-medium);
}

.spotify-setup-steps {
  margin: var(--space-2) 0 0;
  padding-left: var(--space-4);
  color: var(--color-textSecondary);
  line-height: 1.6;
}

.spotify-setup-steps a {
  color: var(--color-primary);
  text-decoration: underline;
}

.spotify-setup-steps code {
  background: var(--color-bgSubtle);
  padding: 1px 4px;
  border-radius: 3px;
  font-size: inherit;
}

.spotify-setup-input-row {
  display: flex;
  gap: var(--space-2);
  width: 100%;
  max-width: 320px;
}

.spotify-setup-input {
  flex: 1;
  min-width: 0;
  padding: var(--space-2) var(--space-3);
  border: 2px solid var(--color-outline, var(--color-borderStrong));
  border-radius: var(--radius-sm);
  background: var(--color-bgElevated);
  color: var(--color-textPrimary);
  font-family: var(--font-family);
  font-size: var(--text-label-size);
  outline: none;
  transition: border-color var(--duration-fast), box-shadow var(--duration-fast);
}

.spotify-setup-input:focus {
  border-color: var(--color-primary);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-primary) 24%, transparent);
}

.spotify-connect-btn {
  padding: var(--space-2) var(--space-4);
  border: 2px solid var(--color-outline, var(--color-primaryDark));
  border-radius: var(--radius-sm);
  background: var(--color-action, var(--color-primary));
  color: var(--color-on-accent, var(--color-textInverse));
  font-family: var(--font-display, var(--font-family));
  font-size: var(--text-label-size);
  font-weight: 600;
  letter-spacing: 0.04em;
  cursor: pointer;
  white-space: nowrap;
  box-shadow: 0 3px 0 0 var(--color-outline, color-mix(in srgb, var(--color-primaryDark) 60%, transparent));
  transition:
    background var(--duration-fast),
    box-shadow var(--duration-fast),
    transform var(--duration-fast);
}

.spotify-connect-btn:hover {
  background: var(--color-actionHover, var(--color-primaryDark));
}

.spotify-connect-btn:active {
  box-shadow: none;
  transform: translateY(2px);
}

.spotify-connect-btn:focus-visible {
  outline: 3px solid var(--color-primary);
  outline-offset: 2px;
}

.spotify-connect-btn--small {
  padding: var(--space-1) var(--space-3);
  font-size: var(--text-micro-size);
}

.spotify-idle {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-2);
}

.spotify-idle-text {
  font-size: var(--text-label-size);
  color: var(--color-textSecondary);
}

.spotify-redir-hint {
  font-size: var(--text-micro-size);
  color: var(--color-textMuted);
  text-align: center;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.spotify-redir-hint code {
  background: var(--color-bgSubtle);
  padding: 1px 4px;
  border-radius: 3px;
  font-size: inherit;
}

.spotify-redir-hint a {
  color: var(--color-primary);
  text-decoration: underline;
}

.spotify-error {
  font-size: var(--text-micro-size);
  line-height: 1.4;
  color: var(--color-danger, #c0392b);
  text-align: center;
  max-width: 340px;
}

@container w (max-width: 16em) {
  .spotify-song {
    font-size: var(--text-label-size);
  }

  .spotify-artist {
    font-size: var(--text-micro-size);
  }
}

@container w (max-width: 10em) {
  .spotify-status {
    display: none;
  }
}

@container w (max-height: 18em) {
  .spotify-body {
    flex-direction: row;
    gap: var(--space-3);
    padding-bottom: 4px;
  }

  .spotify-body--playing {
    align-items: stretch;
    justify-content: flex-start;
    padding: var(--space-3);
  }

  .spotify-body--playing .spotify-stage {
    flex: 0 0 auto;
    width: clamp(48px, 48cqh, 110px);
    padding: 0;
    background: none;
  }

  .spotify-body--playing .spotify-vinyl {
    width: 100%;
  }

  .spotify-body--playing .spotify-info {
    flex: 1;
    min-width: 0;
    padding: 0;
    background: none;
    border-top: none;
    justify-content: center;
  }

  .spotify-body--playing .spotify-progress {
    margin-top: 2px;
  }

  .spotify-idle {
    flex-direction: row;
    flex-wrap: nowrap;
    align-items: center;
    justify-content: flex-start;
    gap: var(--space-3);
    width: 100%;
    min-height: 0;
  }

  .spotify-vinyl--idle {
    width: clamp(36px, 42cqh, 64px);
  }

  .spotify-idle-text {
    flex: 1;
    min-width: 0;
    text-align: left;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .spotify-redir-hint {
    display: none;
  }

  .spotify-connect-btn {
    flex-shrink: 0;
  }

  .spotify-setup {
    width: 100%;
  }

  .spotify-error {
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    overflow: hidden;
  }
}

@container w (max-height: 20em) {
  .spotify-setup-badge {
    display: none;
  }

  .spotify-setup {
    padding: 0;
  }

  .spotify-setup-details {
    display: none;
  }
}

@container w (max-height: 13em) {
  .spotify-setup-title {
    display: none;
  }

  .spotify-setup-desc {
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    overflow: hidden;
  }

  .spotify-setup-input-row {
    max-width: none;
  }
}

@container w (max-height: 9em) {
  .spotify-setup-desc {
    display: none;
  }

  .spotify-error {
    -webkit-line-clamp: 1;
  }
}

@container w (max-height: 13em) and (max-width: 20em) {
  .spotify-connect-btn {
    position: relative;
    min-width: 0;
    min-height: 0;
    padding: var(--space-1) var(--space-2);
    border-width: 1.5px;
    box-shadow: 0 2px 0 0 var(--color-outline, color-mix(in srgb, var(--color-primaryDark) 60%, transparent));
    font-size: var(--text-micro-size);
  }

  .spotify-idle .spotify-connect-btn::after {
    content: "";
    position: absolute;
    inset: -9px -7px;
  }
}

@container w (max-width: 12em) and (max-height: 13em) {
  .spotify-idle-text {
    display: none;
  }
}

@container w (max-width: 10em) and (max-height: 13em) {
  .spotify-idle {
    justify-content: center;
  }

  .spotify-vinyl--idle {
    display: none;
  }
}

@container w (max-height: 4.5em) {
  .spotify-body--playing .spotify-artist,
  .spotify-body--playing .spotify-progress {
    display: none;
  }
}

@container w (max-width: 12em) {
  .spotify-setup-input-row {
    flex-direction: column;
    gap: 4px;
  }

  .spotify-setup-input-row .spotify-setup-input,
  .spotify-setup-input-row .spotify-connect-btn {
    width: 100%;
    padding: 4px var(--space-2);
  }

  .spotify-error {
    display: none;
  }
}

.card-blowup {
  position: fixed;
  inset: 0;
  z-index: 90;
  display: grid;
  place-items: center;
  padding: env(safe-area-inset-top) env(safe-area-inset-right)
    env(safe-area-inset-bottom) env(safe-area-inset-left);
}

.card-blowup__backdrop {
  position: absolute;
  inset: 0;
  background: var(--color-bgBase);
  opacity: 0;
  transition: opacity 220ms cubic-bezier(0.22, 1, 0.36, 1);
}

.card-blowup--ready .card-blowup__backdrop {
  opacity: 0.82;
}

:global(.dark) .card-blowup--ready .card-blowup__backdrop {
  opacity: 0.88;
}

.card-blowup__stage {
  position: relative;
  width: min(94vw, 1480px);
  height: min(88vh, 920px);
}

.card-blowup__stage :deep(.widget) {
  width: 100%;
  height: 100%;
  border-radius: var(--radius-md);
  box-shadow:
    0 34px 90px -34px rgba(0, 0, 0, 0.62),
    0 12px 34px -14px rgba(0, 0, 0, 0.38);
  will-change: transform;
}

.card-blowup__close {
  position: absolute;
  top: max(var(--space-4), env(safe-area-inset-top));
  right: max(var(--space-4), env(safe-area-inset-right));
  z-index: 2;
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  min-width: 44px;
  min-height: 44px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-full);
  background: var(--color-bgElevated);
  color: var(--color-textSecondary);
  box-shadow: 0 8px 24px -10px rgba(0, 0, 0, 0.45);
  cursor: pointer;
  transition:
    background var(--duration-fast),
    color var(--duration-fast),
    transform var(--duration-fast);
}

.card-blowup__close:hover {
  background: var(--color-bgSubtle);
  color: var(--color-textPrimary);
  transform: scale(1.06);
}

.card-blowup__close:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
}

</style>
