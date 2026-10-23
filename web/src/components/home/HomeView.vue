<script setup lang="ts">
import { ref, computed, reactive, watch, onMounted, onUnmounted } from "vue"
import { useEvents } from "@/composables/useEvents"
import { useTasks } from "@/composables/useTasks"
import { useMembers } from "@/composables/useMembers"
import { useUi } from "@/composables/useUi"
import { useWeather } from "@/composables/useWeather"
import { useSpotify } from "@/composables/useSpotify"
import { useSettings } from "@/composables/useSettings"
import { useFittedList } from "@/composables/useFittedList"
import type { Task } from "@/composables/useTasks"
import { householdApi } from "@/api/household"
import { PhArrowRight, PhCircle, PhCheckCircle, PhClock, PhCalendarBlank, PhLock, PhLockOpen, PhDotsSix, PhSun, PhCloud, PhCloudRain, PhCloudSnow, PhCloudFog, PhLightning, PhWind, PhDropHalf, PhMusicNote, PhImage } from "@phosphor-icons/vue"
import UiCard from "@/components/ui/UiCard.vue"
import UiButton from "@/components/ui/UiButton.vue"
import UiEmptyState from "@/components/ui/UiEmptyState.vue"
import { animate, stagger, springs, ease } from "@/lib/motion"

const { events, prefetchAround } = useEvents()
const { todos, doing, ensureLoaded } = useTasks()
const { members, ensureLoaded: loadMembers } = useMembers()
const ui = useUi()
const settings = useSettings()

const { weather, loading: weatherLoading, error: weatherError, refresh: refreshWeather, startAutoRefresh, stopAutoRefresh, weatherLabel } = useWeather()
const { currentTrack, connected: spotifyConnected, error: spotifyError, needsConfig: spotifyNeedsConfig, setClientId, connect: connectSpotify, init: initSpotify, disconnect: disconnectSpotify, formatTime } = useSpotify()
const setupClientId = ref("")
const setupError = ref("")
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

// ── Grid config ──────────────────────────────────────────────────────────────
const GRID_COLS = 6
const GRID_ROWS = 6
const GAP = 12

interface WidgetDef {
  id: string
  col: number
  row: number
  w: number
  h: number
}

/**
 * Every content widget has a minimum footprint it can render cleanly at. The
 * resize handle stops here, so a card can never be shrunk into clipping its
 * header or its first row of content.
 */
const WIDGET_LIMITS: Record<string, { minW: number; minH: number }> = {
  datetime: { minW: 2, minH: 2 },
  weather:  { minW: 2, minH: 2 },
  schedule: { minW: 2, minH: 2 },
  todos:    { minW: 2, minH: 2 },
  spotify:  { minW: 2, minH: 1 },
  calendar: { minW: 2, minH: 2 },
  photos:   { minW: 2, minH: 1 },
}

function limitsFor(id: string) {
  return WIDGET_LIMITS[id] ?? { minW: 1, minH: 1 }
}

const DEFAULT_LAYOUT: WidgetDef[] = [
  { id: "datetime", col: 0, row: 0, w: 3, h: 2 },
  { id: "weather",  col: 3, row: 0, w: 3, h: 2 },
  { id: "schedule", col: 0, row: 2, w: 2, h: 2 },
  { id: "todos",   col: 2, row: 2, w: 2, h: 2 },
  { id: "spotify", col: 4, row: 2, w: 2, h: 2 },
  { id: "calendar", col: 0, row: 4, w: 4, h: 2 },
  { id: "photos",   col: 4, row: 4, w: 2, h: 2 },
]

/**
 * The 4-column layouts shipped before the 6×6 dashboard. Untouched installs
 * are migrated to the roomier default; hand-arranged layouts are left alone.
 */
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

/**
 * The layout shipped before the Spotify widget existed put the player on top of
 * the full-width calendar (cols 2–3, rows 1–2).
 */
const LEGACY_OVERLAPPING_LAYOUT: WidgetDef[] = [
  { id: "datetime", col: 0, row: 0, w: 2, h: 1 },
  { id: "weather",  col: 2, row: 0, w: 2, h: 1 },
  { id: "schedule", col: 0, row: 1, w: 1, h: 1 },
  { id: "todos",   col: 1, row: 1, w: 1, h: 1 },
  { id: "spotify", col: 2, row: 1, w: 2, h: 2 },
  { id: "calendar", col: 0, row: 2, w: 4, h: 2 },
  { id: "photos",   col: 0, row: 4, w: 4, h: 1 },
]

const OUTDATED_DEFAULT_LAYOUTS = [
  FOUR_COLUMN_DEFAULT_LAYOUT,
  ORIGINAL_DEFAULT_LAYOUT,
  LEGACY_OVERLAPPING_LAYOUT,
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

// ═══════════════════════════════════════════════════════════════════════════════
// Layout cache — read synchronously so refresh doesn't flash default positions
// ═══════════════════════════════════════════════════════════════════════════════

const LAYOUT_STORAGE_KEY = 'homst-widget-layout'

function readCachedLayout(): WidgetDef[] | null {
  try {
    const raw = localStorage.getItem(LAYOUT_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return null
    if (parsed.some((w: any) =>
      typeof w?.id !== 'string' ||
      [w?.col, w?.row, w?.w, w?.h].some(n => typeof n !== 'number')
    )) return null
    const layout = parsed as WidgetDef[]
    return isOutdatedDefaultLayout(layout)
      ? DEFAULT_LAYOUT.map(w => ({ ...w }))
      : layout
  } catch {
    return null
  }
}

function writeCachedLayout(layout: WidgetDef[]) {
  try {
    localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(layout))
  } catch {}
}

const cachedLayout = readCachedLayout()
const widgets = reactive<WidgetDef[]>((cachedLayout ?? DEFAULT_LAYOUT).map(w => ({ ...w })))
const layoutReady = ref(!!cachedLayout)

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

function applyLayout(layout: WidgetDef[]) {
  const migrated = isOutdatedDefaultLayout(layout)
  const source = migrated ? DEFAULT_LAYOUT : layout
  const ids = source.map(w => w.id)
  const required = ["datetime", "schedule", "weather", "calendar", "todos"]
  if (!required.every(id => ids.includes(id))) return
  if (source.some(w => [w.col, w.row, w.w, w.h].some(n => typeof n !== "number"))) return
  const merged = source.map(w => ({ ...w }))
  let changed = migrated
  for (const def of DEFAULT_LAYOUT) {
    if (!merged.some(w => w.id === def.id)) {
      const slot = findFreeSlot(def.w, def.h, merged)
      if (slot) {
        merged.push({ ...def, col: slot.col, row: slot.row })
      } else {
        merged.push({ ...def })
      }
      changed = true
    }
  }
  widgets.splice(0, widgets.length, ...merged)
  writeCachedLayout(widgets.map(({ id, col, row, w, h }) => ({ id, col, row, w, h })))
  if (changed) saveLayout()
}

function saveLayout() {
  const layout = widgets.map(({ id, col, row, w, h }) => ({ id, col, row, w, h }))
  writeCachedLayout(layout)
  householdApi.updateSettings({ widgetLayout: layout }).catch(() => { })
}

const unlocked = ref(false)
const lockBtnEl = ref<HTMLElement | null>(null)

// Widget DOM refs for anime.js targeting
const widgetEls: Record<string, HTMLElement> = {}
function registerWidgetEl(id: string, el: HTMLElement | null) {
  if (el) widgetEls[id] = el
  else delete widgetEls[id]
}

// ── Canvas size tracking (ResizeObserver) ─────────────────────────────────────
const canvasEl = ref<HTMLElement | null>(null)
const canvasW = ref(0)
const canvasH = ref(0)
let ro: ResizeObserver | null = null

// Grid unit = distance from one column/row edge to the next (cell + gap)
const colUnit = computed(() => canvasW.value > 0 ? (canvasW.value + GAP) / GRID_COLS : 200)
const rowUnit = computed(() => canvasH.value > 0 ? (canvasH.value + GAP) / GRID_ROWS : 200)

// ── Live clock ────────────────────────────────────────────────────────────────
let clockTimer: ReturnType<typeof setInterval>
const _clockInit = new Date()
const dateStr = ref(_clockInit.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }))
const timeStr = ref(_clockInit.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" }))

// ── Today's schedule ──────────────────────────────────────────────────────────
function eventCoversDate(e: { startAt: string; endAt: string | null; allDay: boolean }, date: Date): boolean {
  const start = new Date(e.startAt)
  const dayStart = new Date(date); dayStart.setHours(0, 0, 0, 0)
  const dayEnd = new Date(dayStart); dayEnd.setDate(dayEnd.getDate() + 1)
  if (start >= dayEnd) return false
  let end = e.endAt ? new Date(e.endAt) : start
  // Legacy all-day events store end_at === start_at; treat them as covering exactly their start day
  if (e.allDay && end.getTime() <= start.getTime()) end = new Date(start.getTime() + 1)
  return end >= dayStart
}
const todayEvents = computed(() =>
  events.value.filter(e => eventCoversDate(e, today.value)).slice(0, 5)
)

// ── Mini calendar ─────────────────────────────────────────────────────────────
const viewYear = ref(today.value.getFullYear())
const viewMonth = ref(today.value.getMonth())

const monthName = computed(() =>
  new Date(viewYear.value, viewMonth.value, 1).toLocaleString("en-US", { month: "long", year: "numeric" })
)

const calendarDays = computed(() => {
  const year = viewYear.value
  const month = viewMonth.value
  const firstDay = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const days: Array<{ date: Date | null; n: number | null }> = []
  for (let i = 0; i < firstDay; i++) days.push({ date: null, n: null })
  for (let d = 1; d <= daysInMonth; d++) days.push({ date: new Date(year, month, d), n: d })
  return days
})

const eventsByDay = computed(() => {
  const map = new Map<string, number>()
  const year = viewYear.value
  const month = viewMonth.value
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  for (let d = 1; d <= daysInMonth; d++) {
    const day = new Date(year, month, d)
    let count = 0
    for (const e of events.value) if (eventCoversDate(e, day)) count++
    if (count > 0) map.set(`${year}-${month}-${d}`, count)
  }
  return map
})

function eventCountForDate(date: Date | null): number {
  if (!date) return 0
  return eventsByDay.value.get(`${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`) ?? 0
}

function isToday(date: Date | null): boolean {
  return !!date && date.toDateString() === today.value.toDateString()
}

function formatEventTime(startAt: string): string {
  return new Date(startAt).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })
}

const ICON_MAP: Record<string, any> = {
  PhSun, PhCloud, PhCloudRain, PhCloudSnow, PhCloudFog, PhLightning,
}

function weatherIcon(code: number): any {
  if (code === 0) return PhSun
  if (code <= 2) return PhCloud
  if (code <= 48) return PhCloudFog
  if (code <= 67) return PhCloudRain
  if (code <= 77) return PhCloudSnow
  if (code <= 86) return PhCloudRain
  return PhLightning
}

// ── Todos ─────────────────────────────────────────────────────────────────────
const homeTodos = computed(() => todos.value.slice(0, 8))
const homeDoing = computed(() => doing.value.slice(0, 3))

// ── Fitted widget lists ───────────────────────────────────────────────────────
// Cards trim to the rows that fit instead of clipping them or scrolling.
const scheduleEntries = computed(() =>
  todayEvents.value.map(event => ({ kind: "row" as const, event })),
)
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

// Group labels are useful breathing room on taller tiles, but waste a row on
// the 1-row minimum. Short tiers drop them and let the icons carry the meaning.
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

// ── Photos slideshow ──────────────────────────────────────────────────────────
const activePhotos = computed(() =>
  (Array.isArray(settings.photos.value) ? settings.photos.value : [])
    .filter(p => p?.selected)
)
// Index is derived from wall-clock time, not stored state: every client has the
// same photo list in the same server order (created_at ASC), so all clients show
// the same photo at the same moment, remounts/reloads never flash photo[0],
// and a server restart can't reset the slideshow to the first photo.
const PHOTO_INTERVAL_MS = 5000
const slideshowNow = ref(Date.now())
const currentPhotoIndex = computed(() => {
  const n = activePhotos.value.length
  return n > 0 ? Math.floor(slideshowNow.value / PHOTO_INTERVAL_MS) % n : 0
})
let photoTimer: ReturnType<typeof setInterval>

// Keep Image objects alive so browser cache stays warm across transitions
const _preloadedImages: HTMLImageElement[] = []
watch(activePhotos, (photos) => {
  _preloadedImages.length = 0
  for (const p of photos) {
    const img = new Image()
    img.src = p.url
    _preloadedImages.push(img)
  }
}, { immediate: true })

// ═══════════════════════════════════════════════════════════════════════════════
// Drag / Resize — window-level listeners, no pointer capture needed
// ═══════════════════════════════════════════════════════════════════════════════

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
    const limits = limitsFor(w.id)
    const maxW = GRID_COLS - w.col
    const maxH = GRID_ROWS - w.row
    const minW = Math.min(limits.minW, maxW)
    const minH = Math.min(limits.minH, maxH)
    const newW = Math.min(maxW, Math.max(minW, dragStartW + colDelta))
    const newH = Math.min(maxH, Math.max(minH, dragStartH + rowDelta))

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

// ── Drag start ────────────────────────────────────────────────────────────────
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

// ── Resize start ──────────────────────────────────────────────────────────────
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

// ── Lock toggle ───────────────────────────────────────────────────────────────
function toggleLock() {
  unlocked.value = !unlocked.value
  if (lockBtnEl.value) {
    animate(lockBtnEl.value, { scale: [0.84, 1], ease: springs.item })
  }
}

// ── Entrance animation ────────────────────────────────────────────────────────
const rootEl = ref<HTMLElement | null>(null)

function onLayoutUpdated(e: Event) {
  applyLayout((e as CustomEvent).detail as WidgetDef[])
}

onMounted(async () => {
  const stored = await householdApi.getSettings().catch(() => null)
  if (stored?.houseName !== undefined) settings.houseName.value = stored.houseName
  if (stored?.widgetLayout) {
    applyLayout(stored.widgetLayout)
  }
  layoutReady.value = true

  window.addEventListener("homst:widget-layout-updated", onLayoutUpdated)

  const weatherOpts = {
    address: stored?.address,
    country: stored?.holidayCountry,
    province: stored?.holidayProvince,
    lat: stored?.lat,
    lon: stored?.lon,
  }
  refreshWeather(weatherOpts)
  startAutoRefresh(weatherOpts)

  const now = new Date()
  ensureLoaded()
  loadMembers()
  prefetchAround(now.getFullYear(), now.getMonth())
  initSpotify()

  // Sub-second tick keeps the time-derived index advancing on wall-clock
  // boundaries and self-corrects drift, so clients stay in sync.
  photoTimer = setInterval(() => { slideshowNow.value = Date.now() }, 500)

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
  window.removeEventListener("homst:widget-layout-updated", onLayoutUpdated)
  clearInterval(photoTimer)
  clearInterval(clockTimer)
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
</script>

<template>
  <div ref="rootEl" class="home-view">
    <!-- Full-page widget canvas -->
    <div v-if="layoutReady" ref="canvasEl" class="widget-canvas" :class="{ 'is-editing': unlocked }" :style="{
      gridTemplateColumns: `repeat(${GRID_COLS}, 1fr)`,
      gridTemplateRows: `repeat(${GRID_ROWS}, 1fr)`,
      gap: `${GAP}px`,
    }">
      <!-- Grid overlay cells (shown in edit mode) -->
      <template v-if="unlocked">
        <div v-for="i in GRID_COLS * GRID_ROWS" :key="'gc-' + i" class="grid-cell-bg" aria-hidden="true" :style="{
          gridColumn: `${((i - 1) % GRID_COLS) + 1}`,
          gridRow: `${Math.floor((i - 1) / GRID_COLS) + 1}`,
        }" />
      </template>

      <!-- Date & Time -->
      <div :ref="(el) => registerWidgetEl('datetime', el as HTMLElement | null)" class="widget"
        :class="{ 'is-dragging': draggingId === 'datetime' }"
        :style="{ ...widgetStyle(getWidget('datetime')!), '--wobble-delay': '0ms' }">
        <UiCard class="home-block" :padding="false">
          <div class="block-header">
            <span class="block-title">
              <PhClock :size="18" /><span class="block-title-text">Date &amp; Time</span>
            </span>
          </div>
          <div class="datetime-display" aria-hidden="true">
            <p class="datetime-house">{{ settings.houseName.value || 'Home' }}</p>
            <p class="datetime-date">{{ dateStr }}</p>
            <p class="datetime-time">{{ timeStr }}</p>
          </div>
        </UiCard>
        <div v-if="unlocked" class="drag-handle" @pointerdown="onDragHandleDown($event, 'datetime')">
          <PhDotsSix :size="14" />
        </div>
        <div v-if="unlocked" class="resize-handle" @pointerdown="onResizeHandleDown($event, 'datetime')" />
      </div>

      <!-- Today's Schedule -->
      <div :ref="(el) => registerWidgetEl('schedule', el as HTMLElement | null)" class="widget"
        :class="{ 'is-dragging': draggingId === 'schedule' }"
        :style="{ ...widgetStyle(getWidget('schedule')!), '--wobble-delay': '220ms' }">
        <UiCard class="home-block" :padding="false">
          <div class="block-header">
            <span class="block-title">
              <PhCalendarBlank :size="18" /><span class="block-title-text">Today's Schedule</span>
            </span>
            <UiButton variant="link" size="sm" @click="ui.setPanel('calendar')">
              Calendar
              <PhArrowRight :size="13" />
            </UiButton>
          </div>
          <div v-if="todayEvents.length" ref="scheduleListEl" class="schedule-list">
            <div v-for="entry in visibleScheduleEvents" :key="entry.event.id" class="schedule-row">
              <span class="schedule-time">{{ formatEventTime(entry.event.startAt) }}</span>
              <span class="schedule-title">{{ entry.event.title }}</span>
              <span v-if="entry.event.assigneeId && members.find(m => m.id === entry.event.assigneeId)" class="schedule-assignee">
                {{ members.find(m => m.id === entry.event.assigneeId)!.name }}
              </span>
            </div>
            <p v-if="hiddenScheduleCount > 0" class="list-more">+{{ hiddenScheduleCount }} more</p>
          </div>
          <UiEmptyState v-else class="widget-empty" message="No events today">
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

      <!-- Weather -->
      <div :ref="(el) => registerWidgetEl('weather', el as HTMLElement | null)" class="widget"
        :class="{ 'is-dragging': draggingId === 'weather' }"
        :style="{ ...widgetStyle(getWidget('weather')!), '--wobble-delay': '120ms' }">
        <UiCard class="home-block" :padding="false">
          <div class="block-header">
            <span class="block-title"><PhSun :size="18" /><span class="block-title-text">Weather</span></span>
            <span v-if="weather" class="weather-location-header">{{ weather.location }}</span>
          </div>
          <div v-if="weatherLoading" class="weather-body weather-body--center">
            <span class="weather-loading">Loading…</span>
          </div>
          <div v-else-if="weatherError" class="weather-body weather-body--center">
            <span class="weather-error">{{ weatherError }}</span>
          </div>
          <div v-else-if="weather" class="weather-body">
            <div class="weather-primary">
              <component :is="weatherIcon(weather.code)" class="weather-icon" :size="52" weight="fill" />
              <div class="weather-temps">
                <span class="weather-temp">{{ weather.temp }}°</span>
                <span class="weather-hilo">
                  <span class="weather-hi">H {{ weather.high }}°</span>
                  <span class="weather-sep">/</span>
                  <span class="weather-lo">L {{ weather.low }}°</span>
                </span>
              </div>
            </div>
            <div class="weather-secondary">
              <span class="weather-label">{{ weatherLabel(weather.code) }}</span>
              <span class="weather-feels">Feels like {{ weather.feelsLike }}°</span>
              <span class="weather-coords">{{ weather.lat.toFixed(4) }}, {{ weather.lon.toFixed(4) }}</span>
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
          <div v-else class="weather-body weather-body--center">
            <span class="weather-loading">No data</span>
          </div>
        </UiCard>
        <div v-if="unlocked" class="drag-handle" @pointerdown="onDragHandleDown($event, 'weather')">
          <PhDotsSix :size="14" />
        </div>
        <div v-if="unlocked" class="resize-handle" @pointerdown="onResizeHandleDown($event, 'weather')" />
      </div>

      <!-- Mini calendar -->
      <div :ref="(el) => registerWidgetEl('calendar', el as HTMLElement | null)" class="widget"
        :class="{ 'is-dragging': draggingId === 'calendar' }"
        :style="{ ...widgetStyle(getWidget('calendar')!), '--wobble-delay': '100ms' }">
        <UiCard class="home-block" :padding="false">
          <div class="block-header">
            <span class="block-title"><span class="block-title-text">{{ monthName }}</span></span>
            <UiButton variant="link" size="sm" @click="ui.setPanel('calendar')">
              Open
              <PhArrowRight :size="13" />
            </UiButton>
          </div>
          <div class="mini-cal">
            <div class="mini-cal-weekdays">
              <span v-for="d in ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']" :key="d">{{ d }}</span>
            </div>
            <div class="mini-cal-grid">
              <button v-for="(day, i) in calendarDays" :key="i" class="mini-cal-day"
                :class="{ 'mini-cal-day--empty': !day.date, 'mini-cal-day--today': isToday(day.date) }"
                :disabled="!day.date" @click="day.date && ui.setPanel('calendar')">
                <span v-if="day.n">{{ day.n }}</span>
                <span v-if="day.date && eventCountForDate(day.date) > 0" class="event-dot" />
              </button>
            </div>
          </div>
        </UiCard>
        <div v-if="unlocked" class="drag-handle" @pointerdown="onDragHandleDown($event, 'calendar')">
          <PhDotsSix :size="14" />
        </div>
        <div v-if="unlocked" class="resize-handle" @pointerdown="onResizeHandleDown($event, 'calendar')" />
      </div>

      <!-- To Do -->
      <div :ref="(el) => registerWidgetEl('todos', el as HTMLElement | null)" class="widget"
        :class="{ 'is-dragging': draggingId === 'todos' }"
        :style="{ ...widgetStyle(getWidget('todos')!), '--wobble-delay': '340ms' }">
        <UiCard class="home-block" :padding="false">
          <div class="block-header">
            <span class="block-title"><span class="block-title-text">To Do</span></span>
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

      <!-- Photos -->
      <div :ref="(el) => registerWidgetEl('photos', el as HTMLElement | null)" class="widget"
        :class="{ 'is-dragging': draggingId === 'photos' }"
        :style="{ ...widgetStyle(getWidget('photos')!), '--wobble-delay': '160ms' }">
        <UiCard class="home-block" :padding="false">
          <div class="block-header">
            <span class="block-title"><PhImage :size="18" /><span class="block-title-text">Photos</span></span>
          </div>
          <div v-if="activePhotos.length" class="photos-body">
            <Transition name="photo-fade">
              <img :key="currentPhotoIndex" :src="activePhotos[currentPhotoIndex]?.url" class="photos-img" />
            </Transition>
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

      <!-- Spotify -->
      <div :ref="(el) => registerWidgetEl('spotify', el as HTMLElement | null)" class="widget"
        :class="{ 'is-dragging': draggingId === 'spotify' }"
        :style="{ ...widgetStyle(getWidget('spotify')!), '--wobble-delay': '280ms' }">
        <UiCard class="home-block spotify-card" :padding="false">
          <div class="block-header">
            <span class="block-title">
              <PhMusicNote :size="18" weight="bold" /><span class="block-title-text">Spotify</span>
            </span>
            <span v-if="spotifyConnected && currentTrack?.isPlaying" class="spotify-equalizer">
              <span /><span /><span />
            </span>
          </div>

          <!-- Not configured — show setup -->
          <div v-if="spotifyNeedsConfig()" class="spotify-body spotify-body--center">
            <div class="spotify-setup">
              <PhMusicNote :size="40" class="spotify-setup-icon" />
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

          <!-- Connected but nothing playing -->
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

          <!-- Now playing -->
          <div v-else class="spotify-body spotify-body--playing">
            <div class="spotify-vinyl" :class="{ 'spotify-vinyl--paused': !currentTrack.isPlaying }">
              <div class="spotify-disc">
                <div class="spotify-label-wrap">
                  <img :src="currentTrack.albumArt" class="spotify-label-art" />
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
                <span class="spotify-time">{{ formatTime(currentTrack.progressMs) }}</span>
                <span class="spotify-time spotify-time--end">{{ formatTime(currentTrack.durationMs) }}</span>
              </div>
            </div>
          </div>
        </UiCard>
        <div v-if="unlocked" class="drag-handle" @pointerdown="onDragHandleDown($event, 'spotify')">
          <PhDotsSix :size="14" />
        </div>
        <div v-if="unlocked" class="resize-handle" @pointerdown="onResizeHandleDown($event, 'spotify')" />
      </div>
    </div>

    <!-- Lock / Unlock FAB — fixed bottom right -->
    <button ref="lockBtnEl" class="lock-toggle" :class="{ 'lock-toggle--unlocked': unlocked }" @click="toggleLock"
      :aria-label="unlocked ? 'Lock layout' : 'Unlock layout'">
      <PhLockOpen v-if="unlocked" :size="18" />
      <PhLock v-else :size="18" />
    </button>
  </div>
</template>

<style scoped>
/* ── Root — fills the main panel ────────────────────────────────────────────── */
.home-view {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
}

/* ── Widget canvas — absolute, fills home-view ──────────────────────────────── */
.widget-canvas {
  position: absolute;
  inset: 0;
  display: grid;
}

/* ── Grid background cells (edit mode) ──────────────────────────────────────── */
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

/* ── Widget ──────────────────────────────────────────────────────────────────── */
.widget {
  position: relative;
  z-index: 2;
  min-width: 0;
  min-height: 0;
  container-type: size;
  container-name: w;
}

.is-editing .widget {
  border-radius: var(--radius-md);
  outline: 2px dashed transparent;
  transition: outline-color var(--duration-fast);
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

/* Wobble in edit mode — slow, smooth sway; staggered phase via negative delay */
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

/* ── Home block (fills widget) ───────────────────────────────────────────────── */
.home-block {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}

/* Empty states are padded for full pages; keep them within small tiles. */
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

/* ── Drag handle ─────────────────────────────────────────────────────────────── */
.drag-handle {
  position: absolute;
  top: 8px;
  right: 8px;
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-sm);
  color: var(--color-textMuted);
  cursor: grab;
  z-index: 4;
  opacity: 0;
  transition: opacity var(--duration-fast), background var(--duration-fast);
  background: var(--color-bgSubtle);
}

.drag-handle:active {
  cursor: grabbing;
}

.is-editing .widget:hover .drag-handle {
  opacity: 1;
}

/* ── Resize handle ───────────────────────────────────────────────────────────── */
.resize-handle {
  position: absolute;
  bottom: 6px;
  right: 6px;
  width: 16px;
  height: 16px;
  border-radius: 3px;
  cursor: nwse-resize;
  z-index: 4;
  opacity: 0;
  transition: opacity var(--duration-fast);
  background: var(--color-primary);
  clip-path: polygon(100% 0, 100% 100%, 0 100%);
}

.is-editing .widget:hover .resize-handle {
  opacity: 0.65;
}

.resize-handle:hover {
  opacity: 1 !important;
}

/* ── Lock toggle FAB ─────────────────────────────────────────────────────────── */
.lock-toggle {
  position: absolute;
  /* relative to home-view — avoids fixed+transform ancestor bug */
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

/* ── Photos slideshow ───────────────────────────────────────────────────────── */
.photos-body {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  min-height: 0;
  position: relative;
}

.photos-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  position: absolute;
  inset: 0;
}

.photo-fade-enter-active,
.photo-fade-leave-active {
  transition: opacity 0.8s ease;
}
.photo-fade-enter-from,
.photo-fade-leave-to {
  opacity: 0;
}

/* ── Shared widget chrome + size tiers ──────────────────────────────────────── */
/* Container font-size follows the household text setting, so em breakpoints
   tighten the layout when text grows — not only when the tile shrinks. */

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
  font-size: var(--text-heading-size);
  font-weight: var(--font-weight-medium);
  line-height: 1.3;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.block-title svg {
  flex-shrink: 0;
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

/* One-row tiles: compact chrome, smaller title, tighter shortcut. */
@container w (max-height: 12em) {
  .block-header {
    padding-top: var(--space-2);
    margin-bottom: var(--space-1);
  }

  .block-title {
    gap: var(--space-1);
    font-size: var(--text-label-size);
  }

  .block-title svg {
    width: 14px;
    height: 14px;
  }

  .block-header :deep(.ui-btn--sm) {
    padding: 0 var(--space-1);
  }
}

@container w (max-height: 8em) {
  .block-header {
    padding-top: var(--space-1);
  }
}

/* Narrow tiles: drop the header shortcut instead of truncating the title. */
@container w (max-width: 16em) {
  .block-header :deep(.ui-btn--sm) {
    display: none;
  }
}

/* ── Date & Time ─────────────────────────────────────────────────────────────── */
.datetime-display {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  gap: clamp(0px, 1cqh, var(--space-2));
  padding: 0 var(--space-3) clamp(2px, 1.5cqh, var(--space-3));
  overflow: hidden;
}

.datetime-house,
.datetime-date,
.datetime-time {
  max-width: 100%;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.datetime-house {
  font-size: clamp(12px, 3.6cqh, 28px);
  line-height: 1.15;
  font-weight: var(--font-weight-large);
  color: var(--color-primary);
}

.datetime-date {
  font-size: clamp(11px, 5.2cqh, 26px);
  line-height: 1.2;
  font-weight: var(--font-weight-thin);
  color: var(--color-textMuted);
}

.datetime-time {
  font-size: clamp(24px, 20cqh, 104px);
  font-weight: var(--font-weight-thin);
  color: var(--color-textPrimary);
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.02em;
  line-height: 0.95;
}

/* ── Weather ──────────────────────────────────────────────────────────────────── */
.weather-location-header {
  flex-shrink: 1;
  min-width: 0;
  max-width: 45%;
  margin-left: auto;
  font-size: var(--text-label-size);
  color: var(--color-textMuted);
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
  gap: clamp(2px, 1.4cqh, var(--space-3));
  padding: 0 clamp(8px, 3cqw, var(--space-6)) clamp(4px, 2cqh, var(--space-3));
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
  gap: clamp(4px, 2cqw, var(--space-4));
  max-width: 100%;
  min-height: 0;
}

.weather-icon {
  color: var(--color-accent);
  flex-shrink: 0;
  width: clamp(24px, 30cqh, 76px);
  height: auto;
}

.weather-temps {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.weather-temp {
  font-size: clamp(24px, 13cqh, 64px);
  font-weight: var(--font-weight-thin);
  line-height: 1;
  color: var(--color-textPrimary);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.weather-hilo {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  font-size: var(--text-label-size);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.weather-hi { color: var(--color-textPrimary); }
.weather-sep { color: var(--color-textMuted); }
.weather-lo { color: var(--color-textMuted); }

.weather-secondary {
  display: flex;
  align-items: baseline;
  justify-content: center;
  gap: var(--space-3);
  min-width: 0;
}

.weather-label {
  font-size: var(--text-body-size);
  font-weight: var(--font-weight-medium);
  color: var(--color-textPrimary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.weather-feels {
  font-size: var(--text-label-size);
  color: var(--color-textMuted);
  white-space: nowrap;
}

.weather-coords {
  font-size: 10px;
  color: var(--color-textMuted);
  opacity: 0.5;
  margin-left: auto;
  white-space: nowrap;
}

.weather-stats {
  display: flex;
  align-items: center;
  gap: var(--space-4);
}

.weather-stat {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: var(--text-label-size);
  color: var(--color-textMuted);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.weather-stat-icon {
  opacity: 0.7;
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

/* Roomy tile: use the width instead of stacking everything in the middle. */
@container w (min-width: 28em) and (min-height: 11em) {
  .weather-body {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    grid-template-rows: auto auto;
    grid-template-areas:
      "primary details"
      "primary stats";
    align-content: center;
    align-items: center;
    justify-items: start;
    column-gap: clamp(12px, 4cqw, var(--space-8));
    text-align: left;
  }

  .weather-primary { grid-area: primary; justify-content: flex-start; }
  .weather-secondary { grid-area: details; justify-content: flex-start; flex-wrap: wrap; }
  .weather-stats { grid-area: stats; justify-content: flex-start; }
}

/* One-row tile: lay the reading out horizontally and drop extras. */
@container w (max-height: 10em) {
  .weather-body {
    flex-direction: row;
    flex-wrap: nowrap;
    justify-content: center;
    gap: clamp(6px, 2cqw, var(--space-4));
    padding-bottom: 4px;
  }

  .weather-primary {
    flex-shrink: 0;
  }

  .weather-secondary {
    flex-direction: column;
    align-items: flex-start;
    justify-content: center;
    gap: 0;
    text-align: left;
    min-width: 0;
  }

  .weather-coords,
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

  .weather-icon {
    width: clamp(22px, 26cqh, 44px);
  }

  .weather-temp {
    font-size: clamp(22px, 12cqh, 34px);
  }
}

/* ── Today's Schedule ────────────────────────────────────────────────────────── */
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
  gap: clamp(4px, 1.5cqw, var(--space-3));
  padding: var(--space-1) var(--space-3);
  border-radius: var(--radius-sm);
  flex-shrink: 0;
  transition: background var(--duration-fast);
}

.schedule-row:hover {
  background: var(--color-bgSubtle);
}

.schedule-time {
  flex-shrink: 0;
  font-size: var(--text-label-size);
  color: var(--color-textMuted);
  font-variant-numeric: tabular-nums;
  width: auto;
  min-width: 3.9em;
  white-space: nowrap;
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

/* "+N more" is a designed end to the list, not clipped content. */
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

@container w (max-height: 9em) {
  .schedule-row,
  .task-row {
    padding-block: 2px;
  }
}

/* ── Mini calendar ───────────────────────────────────────────────────────────── */
.mini-cal {
  padding: 0 var(--space-3) var(--space-2);
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.mini-cal-weekdays {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: clamp(1px, 0.5cqh, 4px);
  flex-shrink: 0;
}

.mini-cal-weekdays span {
  text-align: center;
  font-size: var(--text-micro-size);
  font-weight: var(--font-weight-medium);
  color: var(--color-textMuted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  line-height: 1.2;
  padding-bottom: 2px;
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
  border-radius: var(--radius-sm);
  font-size: clamp(9px, 2.6cqh, var(--text-label-size));
  color: var(--color-textSecondary);
  cursor: pointer;
  min-width: unset;
  min-height: unset;
  padding: 0;
  line-height: 1;
  overflow: hidden;
  transition: background var(--duration-fast);
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

.event-dot {
  position: absolute;
  bottom: 2px;
  left: 50%;
  transform: translateX(-50%);
  width: clamp(3px, 0.5cqh, var(--space-2));
  height: clamp(3px, 0.5cqh, var(--space-2));
  border-radius: 50%;
  background: var(--color-primary);
  opacity: 0.5;
}

.mini-cal-day--today .event-dot {
  background: var(--color-textInverse);
  opacity: 0.7;
}

/* Shorter tiles drop the weekday strip so the month keeps every date. */
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
}

/* Very short tiles keep the month title instead of squashing the date grid. */
@container w (max-height: 7em) {
  .mini-cal-weekdays,
  .mini-cal-grid {
    display: none;
  }

  .mini-cal {
    padding-bottom: var(--space-1);
  }
}

/* ── Tasks ───────────────────────────────────────────────────────────────────── */
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

/* ── Spotify ─────────────────────────────────────────────────── */
@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

@keyframes equalizer {
  0%, 100% { height: 4px; }
  50% { height: 14px; }
}

.spotify-card {
  min-height: 0;
}

.spotify-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: clamp(4px, 2cqh, var(--space-3));
  padding: 0 var(--space-4) clamp(4px, 2cqh, var(--space-3));
  min-height: 0;
  overflow: hidden;
}

.spotify-body--center {
  justify-content: center;
}

/* ── Equalizer bars ──────────────────────────────────────────── */
.spotify-equalizer {
  display: flex;
  align-items: flex-end;
  gap: 3px;
  height: 16px;
}

.spotify-equalizer span {
  display: block;
  width: 3px;
  background: var(--color-primary);
  border-radius: 2px;
  animation: equalizer 0.6s ease-in-out infinite alternate;
}

.spotify-equalizer span:nth-child(2) {
  animation-delay: 0.2s;
  height: 10px;
}

.spotify-equalizer span:nth-child(3) {
  animation-delay: 0.4s;
}

/* ── Vinyl disc ──────────────────────────────────────────────── */
.spotify-vinyl {
  width: clamp(40px, 32cqh, 160px);
  aspect-ratio: 1;
  flex-shrink: 0;
}

.spotify-vinyl--paused {
  opacity: 0.8;
}

.spotify-vinyl--idle {
  opacity: 0.5;
}

/* Full-card vinyl for "now playing" state */
.spotify-body--playing {
  position: relative;
  padding: var(--space-3);
  gap: 0;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
}

.spotify-body--playing .spotify-vinyl {
  width: min(70cqh, 70cqw, 320px);
  max-width: 100%;
  max-height: 100%;
  aspect-ratio: 1;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.spotify-disc {
  width: 100%;
  height: 100%;
  border-radius: 50%;
  background: radial-gradient(circle at 30% 30%, #3a3a3a, #111 65%, #0a0a0a);
  box-shadow:
    0 4px 16px rgba(0, 0, 0, 0.4),
    inset 0 2px 6px rgba(255, 255, 255, 0.05),
    inset 0 -2px 8px rgba(0, 0, 0, 0.3);
  display: flex;
  align-items: center;
  justify-content: center;
  animation: spin 20s linear infinite;
  animation-play-state: paused;
  position: relative;
}

.spotify-disc::before {
  content: "";
  position: absolute;
  inset: 12%;
  border-radius: 50%;
  background: repeating-radial-gradient(
    circle at center,
    transparent 0px,
    transparent 1px,
    rgba(255, 255, 255, 0.02) 1px,
    rgba(255, 255, 255, 0.02) 2px
  );
  pointer-events: none;
}

.spotify-body--playing .spotify-disc {
  border-radius: 50%;
  background: radial-gradient(circle at 30% 30%, #3a3a3a, #111 65%, #0a0a0a);
  box-shadow:
    0 4px 20px rgba(0, 0, 0, 0.5),
    inset 0 2px 6px rgba(255, 255, 255, 0.05);
}

.spotify-body--playing .spotify-disc::before {
  display: block;
  inset: 3%;
}

.spotify-vinyl:not(.spotify-vinyl--paused):not(.spotify-vinyl--idle) .spotify-disc {
  animation-play-state: running;
}

.spotify-label-wrap {
  width: 42%;
  aspect-ratio: 1;
  border-radius: 50%;
  overflow: hidden;
  box-shadow:
    inset 0 0 8px rgba(0, 0, 0, 0.6),
    0 0 0 2px rgba(255, 255, 255, 0.08);
  position: relative;
  z-index: 1;
  background: #222;
}

.spotify-body--playing .spotify-label-wrap {
  width: 94%;
  border-radius: 50%;
  box-shadow: inset 0 0 0 2px rgba(255, 255, 255, 0.12);
  z-index: 1;
}

.spotify-label-wrap--empty {
  display: flex;
  align-items: center;
  justify-content: center;
}

.spotify-label-art {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.spotify-label-placeholder {
  color: var(--color-textMuted);
  opacity: 0.5;
}

/* ── Track info ──────────────────────────────────────────────── */
.spotify-info {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 2px;
  text-align: center;
}

.spotify-body--playing .spotify-info {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  padding: var(--space-6) var(--space-4) var(--space-3);
  background: linear-gradient(
    transparent,
    color-mix(in srgb, var(--color-bgSurface) 70%, transparent) 35%,
    var(--color-bgSurface)
  );
  pointer-events: none;
}

.spotify-song {
  font-size: var(--text-body-size);
  font-weight: var(--font-weight-medium);
  color: var(--color-textPrimary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  line-height: 1.3;
}

.spotify-artist {
  font-size: var(--text-label-size);
  color: var(--color-textMuted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  line-height: 1.3;
}

/* ── Progress bar ────────────────────────────────────────────── */
.spotify-progress {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  width: 100%;
  margin-top: var(--space-1);
}

.spotify-bar-track {
  flex: 1;
  height: 4px;
  background: var(--color-bgSubtle);
  border-radius: 4px;
  overflow: hidden;
}

.spotify-bar-fill {
  height: 100%;
  width: 100%;
  background: var(--color-primary);
  border-radius: 4px;
  transform-origin: left center;
  transition: transform 0.3s linear;
}

.spotify-time {
  font-size: var(--text-micro-size);
  font-variant-numeric: tabular-nums;
  color: var(--color-textMuted);
  flex-shrink: 0;
  min-width: 32px;
}

.spotify-time--end {
  text-align: right;
}

/* ── Setup / Idle states ─────────────────────────────────────── */
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

.spotify-setup-icon {
  color: var(--color-textMuted);
  opacity: 0.4;
}

.spotify-setup-title {
  font-size: var(--text-body-size);
  font-weight: var(--font-weight-medium);
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
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-bgBase);
  color: var(--color-textPrimary);
  font-size: var(--text-label-size);
  outline: none;
  transition: border-color var(--duration-fast);
}

.spotify-setup-input:focus {
  border-color: var(--color-primary);
}

.spotify-connect-btn {
  padding: var(--space-2) var(--space-4);
  border: none;
  border-radius: var(--radius-sm);
  background: var(--color-primary);
  color: var(--color-textInverse);
  font-size: var(--text-label-size);
  font-weight: var(--font-weight-medium);
  cursor: pointer;
  white-space: nowrap;
  transition: background var(--duration-fast);
}

.spotify-connect-btn:hover {
  background: var(--color-primaryDark);
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
  color: var(--color-textMuted);
}

.spotify-redir-hint {
  font-size: 10px;
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
  font-size: 10px;
  line-height: 1.4;
  color: var(--color-danger, #c0392b);
  text-align: center;
  max-width: 340px;
}

/* ── Short / narrow responsive states ────────────────────────── */
@container w (max-width: 16em) {
  .spotify-song {
    font-size: var(--text-label-size);
  }

  .spotify-artist {
    font-size: var(--text-micro-size);
  }
}

/* One-row tiles: vinyl + copy side by side, controls stay reachable. */
@container w (max-height: 16em) {
  .spotify-body {
    flex-direction: row;
    gap: var(--space-3);
    padding-bottom: 4px;
  }

  .spotify-body--playing {
    justify-content: flex-start;
  }

  .spotify-body--playing .spotify-vinyl {
    width: clamp(44px, 62cqh, 96px);
  }

  .spotify-body--playing .spotify-info {
    position: static;
    flex: 1;
    min-width: 0;
    padding: 0;
    background: none;
    text-align: left;
    pointer-events: auto;
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

/* Setup needs the most room: progressively trim prose, keep the form. */
@container w (max-height: 20em) {
  .spotify-setup-icon {
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

/* Tiny one-row tiles: keep the track title, drop the rest of the details. */
@container w (max-height: 4.5em) {
  .spotify-body--playing .spotify-artist,
  .spotify-body--playing .spotify-progress {
    display: none;
  }
}
</style>
