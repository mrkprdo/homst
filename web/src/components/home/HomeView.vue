<script setup lang="ts">
import { ref, computed, reactive, watch, onMounted, onUnmounted } from "vue"
import { useEvents } from "@/composables/useEvents"
import { useTasks } from "@/composables/useTasks"
import { useMembers } from "@/composables/useMembers"
import { useUi } from "@/composables/useUi"
import { useWeather } from "@/composables/useWeather"
import { useSpotify } from "@/composables/useSpotify"
import { useSettings } from "@/composables/useSettings"
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
const GRID_COLS = 4
const GRID_ROWS = 5
const GAP = 12

interface WidgetDef {
  id: string
  col: number
  row: number
  w: number
  h: number
}

const DEFAULT_LAYOUT: WidgetDef[] = [
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
 * the full-width calendar (cols 2–3, rows 1–2). Untouched installs are migrated
 * to the corrected default; hand-arranged layouts are left alone.
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

function isLegacyOverlappingLayout(layout: WidgetDef[]): boolean {
  if (layout.length !== LEGACY_OVERLAPPING_LAYOUT.length) return false
  return LEGACY_OVERLAPPING_LAYOUT.every(def => {
    const w = layout.find(x => x.id === def.id)
    return !!w && w.col === def.col && w.row === def.row && w.w === def.w && w.h === def.h
  })
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
    return isLegacyOverlappingLayout(layout)
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
  const migrated = isLegacyOverlappingLayout(layout)
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
    const newW = Math.max(1, Math.min(GRID_COLS - w.col, dragStartW + colDelta))
    const newH = Math.max(1, Math.min(GRID_ROWS - w.row, dragStartH + rowDelta))

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
              <PhClock :size="18" /> Date &amp; Time
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
              <PhCalendarBlank :size="18" /> Today's Schedule
            </span>
            <UiButton variant="link" size="sm" @click="ui.setPanel('calendar')">
              Calendar
              <PhArrowRight :size="13" />
            </UiButton>
          </div>
          <div v-if="todayEvents.length" class="schedule-list">
            <div v-for="ev in todayEvents" :key="ev.id" class="schedule-row">
              <span class="schedule-time">{{ formatEventTime(ev.startAt) }}</span>
              <span class="schedule-title">{{ ev.title }}</span>
              <span v-if="ev.assigneeId && members.find(m => m.id === ev.assigneeId)" class="schedule-assignee">
                {{ members.find(m => m.id === ev.assigneeId)!.name }}
              </span>
            </div>
          </div>
          <UiEmptyState v-else message="No events today">
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
            <span class="block-title"><PhSun :size="18" /> Weather</span>
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
            <span class="block-title">{{ monthName }}</span>
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
            <span class="block-title">To Do</span>
            <UiButton variant="link" size="sm" @click="ui.setPanel('tasks')">
              All
              <PhArrowRight :size="13" />
            </UiButton>
          </div>
          <div v-if="homeDoing.length || homeTodos.length" class="task-scroll">
            <div v-if="homeDoing.length" class="task-group">
              <span class="task-group-label">In progress</span>
              <div v-for="task in homeDoing" :key="task.id" class="task-row task-row--doing">
                <PhCircle :size="16" weight="bold" class="task-icon task-icon--doing" />
                <span class="task-title">{{ task.title }}</span>
              </div>
            </div>
            <div v-if="homeTodos.length" class="task-group">
              <span v-if="homeDoing.length" class="task-group-label">Up next</span>
              <div v-for="task in homeTodos" :key="task.id" class="task-row">
                <PhCircle :size="16" class="task-icon" />
                <span class="task-title">{{ task.title }}</span>
                <span v-if="task.startAt" class="task-due"
                  :class="{ 'task-due--overdue': new Date(task.startAt) < today }">
                  {{ new Date(task.startAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) }}
                </span>
              </div>
            </div>
          </div>
          <UiEmptyState v-if="!homeTodos.length && !homeDoing.length" message="All clear">
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
            <span class="block-title"><PhImage :size="18" /> Photos</span>
          </div>
          <div v-if="activePhotos.length" class="photos-body">
            <Transition name="photo-fade">
              <img :key="currentPhotoIndex" :src="activePhotos[currentPhotoIndex]?.url" class="photos-img" />
            </Transition>
          </div>
          <UiEmptyState v-else message="No photos selected">
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
              <PhMusicNote :size="18" weight="bold" /> Spotify
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
}

/* UiCard slot content — ensure children fill height and don't overflow */
.home-block :deep(.ui-card) {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
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

/* ── Container-query adaptive content ───────────────────────────────────────── */


/* Short widget (1 row tall): collapse calendar to just the month name */
@container w (max-height: 260px) {

  .mini-cal-weekdays,
  .mini-cal-grid {
    display: none;
  }

  .mini-cal {
    padding-bottom: var(--space-2);
  }
}

/* Very narrow (1 col): tighter day cells, smaller text */
@container w (max-width: 240px) {
  .mini-cal-weekdays span {
    font-size: 8px;
    letter-spacing: 0;
  }

  .mini-cal-day {
    font-size: 9px;
  }

  .block-title {
    font-size: 13px;
  }

  .schedule-time {
    min-width: 44px;
    font-size: 11px;
  }

  .datetime-time {
    font-size: 22px;
  }
}

/* Compact header when short */
@container w (max-height: 180px) {
  .block-header {
    margin-bottom: var(--space-1);
    padding-top: var(--space-2);
  }

  .datetime-display {
    padding: var(--space-1) 0;
  }

  .datetime-time {
    font-size: 20px;
  }

  .schedule-list {
    gap: 0;
  }

  .schedule-row {
    padding: 2px var(--space-2);
  }

  .task-row {
    padding: 2px var(--space-2);
  }
}

/* ── Block header ────────────────────────────────────────────────────────────── */
.block-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--space-3);
  padding: var(--space-3) var(--space-4) 0;
}

.block-title {
  font-size: var(--text-heading-size);
  font-weight: var(--font-weight-medium);
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

/* ── Date & Time ─────────────────────────────────────────────────────────────── */
.datetime-display {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  gap: var(--space-2);
}

.datetime-house {
  font-size: clamp(16px, 4cqw, 28px);
  font-weight: var(--font-weight-large);
  color: var(--color-primary);
}

.datetime-date {
  font-size: clamp(24px, 12cqh, 80px);
  font-weight: var(--font-weight-thin);
  color: var(--color-textMuted);
}

.datetime-time {
  font-size: clamp(24px, 12cqh, 80px);
  font-weight: var(--font-weight-thin);
  color: var(--color-textPrimary);
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.02em;
  line-height: 1;
}

/* ── Weather ──────────────────────────────────────────────────────────────────── */
.weather-location-header {
  font-size: var(--text-label-size);
  color: var(--color-textMuted);
  margin-left: auto;
}

.weather-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  padding: 0 var(--space-4) var(--space-3);
}

.weather-body--center {
  align-items: center;
}

.weather-primary {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.weather-icon {
  color: var(--color-accent);
  flex-shrink: 0;
}

.weather-temps {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.weather-temp {
  font-size: clamp(28px, 8cqh, 48px);
  font-weight: var(--font-weight-thin);
  line-height: 1;
  color: var(--color-textPrimary);
  font-variant-numeric: tabular-nums;
}

.weather-hilo {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  font-size: var(--text-label-size);
  font-variant-numeric: tabular-nums;
}

.weather-hi { color: var(--color-textPrimary); }
.weather-sep { color: var(--color-textMuted); }
.weather-lo { color: var(--color-textMuted); }

.weather-secondary {
  display: flex;
  align-items: baseline;
  gap: var(--space-3);
}

.weather-label {
  font-size: var(--text-body-size);
  font-weight: var(--font-weight-medium);
  color: var(--color-textPrimary);
}

.weather-feels {
  font-size: var(--text-label-size);
  color: var(--color-textMuted);
}

.weather-coords {
  font-size: 10px;
  color: var(--color-textMuted);
  opacity: 0.5;
  margin-left: auto;
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
}

.weather-stat-icon {
  opacity: 0.7;
}

.weather-loading,
.weather-error {
  font-size: var(--text-body-size);
  color: var(--color-textMuted);
}

.weather-error {
  color: var(--color-danger);
}

/* ── Today's Schedule ────────────────────────────────────────────────────────── */
.schedule-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 0 var(--space-3);
  overflow-y: auto;
  flex: 1;
  min-height: 0;
}

.schedule-row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-2);
  border-radius: var(--radius-sm);
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
  min-width: 58px;
  white-space: nowrap;
}

.schedule-title {
  flex: 1;
  font-size: var(--text-body-size);
  color: var(--color-textPrimary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.schedule-assignee {
  flex-shrink: 0;
  font-size: var(--text-label-size);
  color: var(--color-textMuted);
  white-space: nowrap;
}

/* ── Mini calendar ───────────────────────────────────────────────────────────── */
.mini-cal {
  padding: 0 var(--space-3) var(--space-3);
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.mini-cal-weekdays {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  margin-bottom: var(--space-1);
}

.mini-cal-weekdays span {
  text-align: center;
  font-size: var(--text-micro-size);
  font-weight: var(--font-weight-medium);
  color: var(--color-textMuted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding-bottom: var(--space-1);
}

.mini-cal-grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  grid-auto-rows: 1fr;
  gap: var(--space-1);
  flex: 1;
  min-height: 0;
}

.mini-cal-day {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  /* aspect-ratio: 1 removed — flex grid fills available height */
  border: none;
  background: none;
  border-radius: var(--radius-sm);
  font-size: var(--text-label-size);
  color: var(--color-textSecondary);
  cursor: pointer;
  min-width: unset;
  min-height: unset;
  padding: 0;
  line-height: 1;
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
  width: var(--space-2);
  height: var(--space-2);
  border-radius: 50%;
  background: var(--color-primary);
  opacity: 0.5;
}

.mini-cal-day--today .event-dot {
  background: var(--color-textInverse);
  opacity: 0.7;
}

/* ── Tasks ───────────────────────────────────────────────────────────────────── */
.task-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding-bottom: var(--space-2);
}

.task-group {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-bottom: var(--space-3);
  padding: 0 var(--space-3);
}

.task-group:last-child {
  margin-bottom: 0;
}

.task-group-label {
  font-size: 10px;
  font-weight: var(--font-weight-medium);
  color: var(--color-textMuted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: var(--space-1);
}

.task-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2);
  border-radius: var(--radius-sm);
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
  gap: var(--space-3);
  padding: var(--space-1) var(--space-4) var(--space-3);
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
  width: clamp(80px, 60%, 160px);
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
  max-width: 100%;
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

/* ── Compact narrow ──────────────────────────────────────────── */
@container w (max-width: 240px) {
  .spotify-vinyl {
    width: clamp(60px, 50%, 100px);
  }

  .spotify-song {
    font-size: var(--text-label-size);
  }

  .spotify-artist {
    font-size: 10px;
  }
}

@container w (max-height: 280px) {
  .spotify-vinyl {
    width: clamp(50px, 35%, 80px);
  }

  .spotify-body {
    flex-direction: row;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  .spotify-info {
    flex: 1;
    min-width: 0;
  }

  /* Short cards: vinyl opens to the left so the message and action stay visible */
  .spotify-idle {
    flex-direction: row;
    flex-wrap: wrap;
    align-items: center;
    justify-content: center;
    gap: var(--space-1) var(--space-4);
    width: 100%;
    min-height: 0;
  }

  .spotify-idle-text {
    flex: 1;
    min-width: 120px;
    text-align: left;
  }

  .spotify-redir-hint {
    flex-basis: 100%;
    order: 9;
  }

  .spotify-connect-btn {
    flex-shrink: 0;
  }
}
</style>
