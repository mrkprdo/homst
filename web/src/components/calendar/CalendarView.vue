<script setup lang="ts">
import { ref, computed, nextTick, watch, onMounted, onUnmounted } from "vue"
import { useEvents, type Event } from "@/composables/useEvents"
import { useMembers } from "@/composables/useMembers"
import { useUi } from "@/composables/useUi"
import { useSettings } from "@/composables/useSettings"
import { memberColorHex, type MemberColor } from "@/types/household"
import { PhPlus, PhCaretLeft, PhCaretRight } from "@phosphor-icons/vue"
import EventChip from "@/components/ui/EventChip.vue"
import UiButton from "@/components/ui/UiButton.vue"
import UiSegmentedControl from "@/components/ui/UiSegmentedControl.vue"

type ViewMode = "month" | "week" | "day"

const { events, loading, prefetchAround } = useEvents()
const { members, ensureLoaded: loadMembers } = useMembers()
const ui = useUi()
const { accentColor, accentPalette } = useSettings()

const now = ref(new Date())
let nowInterval: ReturnType<typeof setInterval> | null = null

onMounted(async () => {
  const target = ui.consumeCalendarTarget()
  if (target) {
    const targetDate = new Date(target.date)
    if (!Number.isNaN(targetDate.getTime())) {
      selectedDate.value = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate())
      currentYear.value = targetDate.getFullYear()
      currentMonth.value = targetDate.getMonth()
    }
  }

  await Promise.all([
    loadMembers(),
    prefetchAround(currentYear.value, currentMonth.value),
  ])

  if (target?.eventId) ui.openDrawer("event-detail", target.eventId)
  nowInterval = setInterval(() => { now.value = new Date() }, 60000)
})

onUnmounted(() => {
  if (nowInterval !== null) clearInterval(nowInterval)
})

const UNASSIGNED_COLOR = "#d4cdc8"

function eventChipColor(ev: Pick<Event, "assigneeId">): string {
  if (!ev.assigneeId) return UNASSIGNED_COLOR
  const m = members.value.find((m) => m.id === ev.assigneeId)
  if (!m) return UNASSIGNED_COLOR
  return m.color.startsWith("#") ? m.color : memberColorHex(m.color as MemberColor)
}

function eventChipTitle(ev: Pick<Event, "assigneeId" | "title">): string {
  if (!ev.assigneeId) return ev.title
  const m = members.value.find((m) => m.id === ev.assigneeId)
  return m ? `${m.name} - ${ev.title}` : ev.title
}

function handleNavChange(year: number, month: number) {
  prefetchAround(year, month)
}

const viewMode = ref<ViewMode>("month")
const selectedDate = ref(new Date())

// ── Month view state
const currentMonth = ref(new Date().getMonth())
const currentYear = ref(new Date().getFullYear())
const monthNavDir = ref<"forward" | "back">("forward")

const monthNames = ["January","February","March","April","May","June","July","August","September","October","November","December"]
const dayNames = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"]
const weekDayNames = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"]

const today = computed(() => {
  const d = new Date(now.value)
  d.setHours(0, 0, 0, 0)
  return d
})

// ── Month view
const daysInMonth = computed(() => new Date(currentYear.value, currentMonth.value + 1, 0).getDate())
const firstDayOfMonth = computed(() => new Date(currentYear.value, currentMonth.value, 1).getDay())
const monthLabel = computed(() => `${monthNames[currentMonth.value]} ${currentYear.value}`)

function prevMonth() {
  monthNavDir.value = "back"
  if (currentMonth.value === 0) { currentMonth.value = 11; currentYear.value-- }
  else currentMonth.value--
  handleNavChange(currentYear.value, currentMonth.value)
}
function nextMonth() {
  monthNavDir.value = "forward"
  if (currentMonth.value === 11) { currentMonth.value = 0; currentYear.value++ }
  else currentMonth.value++
  handleNavChange(currentYear.value, currentMonth.value)
}
function goToToday() { const n=new Date(); currentMonth.value=n.getMonth(); currentYear.value=n.getFullYear(); selectedDate.value=n }
function selectDay(day:number) { selectedDate.value = new Date(currentYear.value, currentMonth.value, day) }
function formatDateInput(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}
function onMonthDayDblClick(day: number) {
  ui.openDrawer("quick-add", undefined, formatDateInput(new Date(currentYear.value, currentMonth.value, day)))
}
function isToday(day:number):boolean { return today.value.getDate()===day && today.value.getMonth()===currentMonth.value && today.value.getFullYear()===currentYear.value }
function isSelected(day:number):boolean { return selectedDate.value.getDate()===day && selectedDate.value.getMonth()===currentMonth.value && selectedDate.value.getFullYear()===currentYear.value }
function eventsForDay(day:number) { return eventsForDate(new Date(currentYear.value, currentMonth.value, day)) }
function coversDate(ev: Event, date: Date): boolean {
  const start = new Date(ev.startAt)
  const dayStart = new Date(date); dayStart.setHours(0, 0, 0, 0)
  const dayEnd = new Date(dayStart); dayEnd.setDate(dayEnd.getDate() + 1)
  if (start >= dayEnd) return false
  let end = ev.endAt ? new Date(ev.endAt) : start
  // Legacy all-day events store end_at === start_at; treat them as covering exactly their start day
  if (ev.allDay && end.getTime() <= start.getTime()) end = new Date(start.getTime() + 1)
  return end >= dayStart
}
function eventsForDate(date: Date) { return expandedEvents.value.filter(e => coversDate(e, date)) }

// Previous month trailing days to fill first row
const prevMonthDays = computed(() => {
  const prevMonth = currentMonth.value === 0 ? 11 : currentMonth.value - 1
  const prevYear = currentMonth.value === 0 ? currentYear.value - 1 : currentYear.value
  const daysInPrevMonth = new Date(prevYear, prevMonth + 1, 0).getDate()
  const days: { day: number; month: number; year: number }[] = []
  for (let i = 0; i < firstDayOfMonth.value; i++) {
    days.push({ day: daysInPrevMonth - firstDayOfMonth.value + i + 1, month: prevMonth, year: prevYear })
  }
  return days
})

// Next month leading days to fill last row
const nextMonthDays = computed(() => {
  const totalCells = firstDayOfMonth.value + daysInMonth.value
  const remaining = totalCells % 7 === 0 ? 0 : 7 - (totalCells % 7)
  const nextMonth = currentMonth.value === 11 ? 0 : currentMonth.value + 1
  const nextYear = currentMonth.value === 11 ? currentYear.value + 1 : currentYear.value
  const days: { day: number; month: number; year: number }[] = []
  for (let i = 1; i <= remaining; i++) {
    days.push({ day: i, month: nextMonth, year: nextYear })
  }
  return days
})

function navigateToMonth(month: number, year: number, day?: number) {
  if (year > currentYear.value || (year === currentYear.value && month > currentMonth.value)) {
    monthNavDir.value = "forward"
  } else {
    monthNavDir.value = "back"
  }
  currentMonth.value = month
  currentYear.value = year
  if (day !== undefined) {
    selectedDate.value = new Date(year, month, day)
  }
}

// ── Week view
const weekStart = computed(() => {
  const d = new Date(selectedDate.value)
  d.setDate(d.getDate() - d.getDay()) // Sunday start
  d.setHours(0, 0, 0, 0)
  return d
})

const weekDays = computed(() => {
  const days: { date: Date; label: string; dayName: string; isToday: boolean }[] = []
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStart.value)
    d.setDate(d.getDate() + i)
    days.push({
      date: d,
      label: String(d.getDate()),
      dayName: dayNames[i] ?? "",
      isToday: d.toDateString() === today.value.toDateString(),
    })
  }
  return days
})

const hoursOfDay = Array.from({ length: 24 }, (_, i) => i)
const weekScrollEl = ref<HTMLElement | null>(null)

const weekLabel = computed(() => {
  const s = weekStart.value
  const e = new Date(s)
  e.setDate(e.getDate() + 6)
  const fmt = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" })
  return `${fmt(s)} – ${fmt(e)}, ${s.getFullYear()}`
})

function prevWeek() {
  const d = new Date(selectedDate.value)
  d.setDate(d.getDate() - 7)
  selectedDate.value = d
  handleNavChange(d.getFullYear(), d.getMonth())
}
function nextWeek() {
  const d = new Date(selectedDate.value)
  d.setDate(d.getDate() + 7)
  selectedDate.value = d
  handleNavChange(d.getFullYear(), d.getMonth())
}

// ── Recurrence expansion ──
// Events store only the base instance. Expand into individual occurrences
// for the display window so all filter functions see real dates.
const RECUR_FROM = new Date(new Date().getFullYear() - 1, 0, 1)
const RECUR_TO   = new Date(new Date().getFullYear() + 2, 11, 31)

function expandRecurring(ev: Event, from: Date, to: Date): Event[] {
  const rec = ev.recurrence as { freq?: string; until?: string; count?: number } | null
  if (!rec?.freq) return [ev]

  const origStart  = new Date(ev.startAt)
  const durationMs = Math.max(new Date(ev.endAt ?? ev.startAt).getTime() - origStart.getTime(), 0)
  const endBound   = rec.until ? new Date(rec.until) : to
  const maxPush    = rec.count ?? 730  // cap on pushed instances, not iterations

  function stepCursor(d: Date): Date {
    const next = new Date(d)
    switch (rec!.freq) {
      case "daily":    next.setDate(next.getDate() + 1); break
      case "weekly":   next.setDate(next.getDate() + 7); break
      case "biweekly": next.setDate(next.getDate() + 14); break
      case "monthly":  next.setMonth(next.getMonth() + 1); break
      case "yearly":   next.setFullYear(next.getFullYear() + 1); break
      default:         return new Date(endBound.getTime() + 1)  // unknown freq — exits loop
    }
    return next
  }

  let cursor = new Date(origStart)
  let n = 0

  // Fast-forward: skip iterations before `from` for fixed-day-count frequencies
  if (cursor < from) {
    const msStep = rec.freq === "daily"    ? 86400_000
      : rec.freq === "weekly"   ? 7  * 86400_000
      : rec.freq === "biweekly" ? 14 * 86400_000
      : 0
    if (msStep > 0) {
      const skip = Math.max(0, Math.floor((from.getTime() - cursor.getTime()) / msStep) - 1)
      cursor = new Date(cursor.getTime() + skip * msStep)
      n = skip
    }
  }

  const instances: Event[] = []
  while (cursor <= endBound && instances.length < maxPush) {
    if (cursor >= from) {
      instances.push({
        ...ev,
        id: `${ev.id}::${n}`,
        startAt: cursor.toISOString(),
        endAt: new Date(cursor.getTime() + durationMs).toISOString(),
      })
    }
    cursor = stepCursor(cursor)
    n++
  }

  return instances.length ? instances : [ev]
}

const expandedEvents = computed<Event[]>(() =>
  events.value.flatMap(ev => ev.recurrence ? expandRecurring(ev, RECUR_FROM, RECUR_TO) : [ev])
)

// Auto-scroll to the useful part of the day when switching views: current
// time for the live day/week, otherwise the start of the working morning.
function scrollWeekToRelevantTime() {
  nextTick(() => {
    const el = weekScrollEl.value
    if (!el) return
    const hour = isCurrentWeek.value ? Math.max(0, now.value.getHours() - 2) : 6
    el.scrollTop = WEEK_ROW_HEIGHT * hour
  })
}

watch(viewMode, (v) => { if (v === "week") scrollWeekToRelevantTime() })

function formatEventTime(startAt: string) {
  const d = new Date(startAt)
  const h = d.getHours()
  const m = d.getMinutes()
  const ampm = h < 12 ? "am" : "pm"
  return `${h % 12 || 12}${m ? ":" + String(m).padStart(2, "0") : ""}${ampm}`
}

function isSameDate(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

function allDayEventsForDate(date: Date) {
  return expandedEvents.value.filter(e => e.allDay && coversDate(e, date))
}

function timedEventsForDate(date: Date) {
  return expandedEvents.value.filter(e => !e.allDay && coversDate(e, date))
}

const hasAllDayEvents = computed(() =>
  weekDays.value.some(d => allDayEventsForDate(d.date).length > 0)
)

const todayDayIdx = computed(() => weekDays.value.findIndex(d => d.isToday))

const isCurrentWeek = computed(() => todayDayIdx.value >= 0)

function onWeekDayClick(date: Date, e?: MouseEvent) {
  selectedDate.value = date
  let time: string | undefined
  if (e) {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const hour = Math.min(23, Math.max(0, Math.floor((e.clientY - rect.top) / WEEK_ROW_HEIGHT)))
    time = `${String(hour).padStart(2, "0")}:00`
  }
  ui.openDrawer("quick-add", undefined, formatDateInput(date), time)
}

const WEEK_ROW_HEIGHT = 56 // px per hour row, must match .week-grid grid-auto-rows

const currentTimePx = computed(() => {
  const h = now.value.getHours()
  const m = now.value.getMinutes()
  return (h + m / 60) * WEEK_ROW_HEIGHT
})

const currentTimeLabel = computed(() =>
  now.value.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
)

interface TimedEventLayoutItem {
  event: Event
  startMin: number
  endMin: number
  duration: number
  lane: number
  lanes: number
  compact: boolean
  timeLabel: string
}

/**
 * Pack each day's timed events into lanes so concurrent events sit side by
 * side instead of covering each other. Events are grouped into clusters of
 * overlapping time; every member of a cluster shares the same lane count.
 */
function timedEventLayoutForDate(date: Date): TimedEventLayoutItem[] {
  const dayStart = new Date(date); dayStart.setHours(0, 0, 0, 0)
  const dayEnd = new Date(dayStart); dayEnd.setDate(dayEnd.getDate() + 1)

  const items: TimedEventLayoutItem[] = timedEventsForDate(date).map(event => {
    const start = new Date(event.startAt)
    const end = new Date(event.endAt ?? event.startAt)
    const clampedStart = start < dayStart ? dayStart : start
    const clampedEnd = end > dayEnd ? dayEnd : end
    const startMin = Math.max(0, (clampedStart.getTime() - dayStart.getTime()) / 60000)
    const endMin = Math.min(1440, (clampedEnd.getTime() - dayStart.getTime()) / 60000)
    const duration = Math.max(endMin - startMin, 15)
    return {
      event,
      startMin,
      endMin: startMin + duration,
      duration,
      lane: 0,
      lanes: 1,
      compact: duration < 45,
      timeLabel: formatEventTime(clampedStart.toISOString()),
    }
  }).sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin)

  let cluster: TimedEventLayoutItem[] = []
  let laneEnds: number[] = []
  let clusterEnd = -1

  function finishCluster() {
    const lanes = Math.max(laneEnds.length, 1)
    for (const item of cluster) item.lanes = lanes
    cluster = []
    laneEnds = []
    clusterEnd = -1
  }

  for (const item of items) {
    if (cluster.length && item.startMin >= clusterEnd) finishCluster()
    let lane = laneEnds.findIndex(end => end <= item.startMin)
    if (lane === -1) {
      lane = laneEnds.length
      laneEnds.push(item.endMin)
    } else {
      laneEnds[lane] = item.endMin
    }
    item.lane = lane
    cluster.push(item)
    clusterEnd = Math.max(clusterEnd, item.endMin)
  }
  finishCluster()

  return items
}

function timedEventStyle(item: TimedEventLayoutItem): Record<string, string> {
  const width = 100 / item.lanes
  return {
    top: `${(item.startMin / 60) * WEEK_ROW_HEIGHT}px`,
    height: `${(item.duration / 60) * WEEK_ROW_HEIGHT}px`,
    left: `calc(${item.lane * width}% + 2px)`,
    width: `calc(${width}% - 4px)`,
    "--event-color": eventChipColor(item.event),
  }
}

function eventBlockTooltip(event: Event, timeLabel: string): string {
  return `${timeLabel} · ${eventChipTitle(event)}`
}

const selectedDayEventLabel = computed(() => {
  const count = expandedEvents.value.filter(event => coversDate(event, selectedDate.value)).length
  return count === 0 ? "No events" : `${count} ${count === 1 ? "event" : "events"}`
})

function openDayFromWeek(date: Date) {
  selectedDate.value = new Date(date)
  viewMode.value = "day"
  handleNavChange(date.getFullYear(), date.getMonth())
}

// ── Day view
function prevDay() {
  const d = new Date(selectedDate.value)
  d.setDate(d.getDate() - 1)
  selectedDate.value = d
  handleNavChange(d.getFullYear(), d.getMonth())
}
function nextDay() {
  const d = new Date(selectedDate.value)
  d.setDate(d.getDate() + 1)
  selectedDate.value = d
  handleNavChange(d.getFullYear(), d.getMonth())
}

function navPrev() { if(viewMode.value==="month")prevMonth();else if(viewMode.value==="week")prevWeek();else prevDay() }
function navNext() { if(viewMode.value==="month")nextMonth();else if(viewMode.value==="week")nextWeek();else nextDay() }

const navLabel = computed(() => {
  if(viewMode.value==="month")return monthLabel.value
  if(viewMode.value==="week")return weekLabel.value
  return selectedDate.value.toLocaleDateString("en-US",{weekday:"long",month:"long",day:"numeric",year:"numeric"})
})

const dayScrollEl = ref<HTMLElement | null>(null)
const isSelectedToday = computed(() => isSameDate(selectedDate.value, today.value))

function scrollDayToRelevantTime() {
  nextTick(() => {
    if (!dayScrollEl.value) return
    const hour = isSelectedToday.value ? Math.max(0, now.value.getHours() - 2) : 6
    dayScrollEl.value.scrollTop = WEEK_ROW_HEIGHT * hour
  })
}

watch(viewMode, (v) => { if (v === "day") scrollDayToRelevantTime() })

function onEventClick(eventId: string) {
  ui.openDrawer("event-detail", eventId.split("::")[0])
}
</script>

<template>
  <div class="calendar-view">
    <!-- Toolbar -->
    <div class="calendar-toolbar">
      <div class="calendar-nav">
        <button class="nav-arrow" @click="navPrev" aria-label="Previous"><PhCaretLeft :size="16" /></button>
        <button class="nav-arrow" @click="navNext" aria-label="Next"><PhCaretRight :size="16" /></button>
        <Transition v-if="viewMode !== 'day'" :name="viewMode==='month'?(monthNavDir==='forward'?'nav-forward':'nav-back'):'nav-forward'" mode="out-in">
          <h2 class="nav-label" :key="navLabel">{{ navLabel }}</h2>
        </Transition>
        <h2 v-else class="nav-label">{{ navLabel }}</h2>
      </div>
      <div class="calendar-actions">
        <UiSegmentedControl
          :model-value="viewMode"
          :options="[{value:'month',label:'Month'},{value:'week',label:'Week'},{value:'day',label:'Day'}]"
          @update:model-value="(v) => viewMode = v as ViewMode"
        />
        <button class="text-btn" @click="goToToday">Today</button>
        <UiButton @click="ui.openDrawer('quick-add', undefined, selectedDate.toISOString().slice(0, 10))"><PhPlus :size="16" weight="bold" />Add</UiButton>
      </div>
    </div>

    <!-- Month Grid -->
    <div v-if="viewMode==='month'" class="month-view">
      <div class="day-headers">
        <div v-for="d in dayNames" :key="d" class="day-header">{{ d }}</div>
      </div>
      <div class="month-grid">
        <!-- Previous month days -->
        <div
          v-for="d in prevMonthDays"
          :key="'p'+d.year+'-'+d.month+'-'+d.day"
          class="day-cell adjacent"
          @click="navigateToMonth(d.month, d.year, d.day)"
        >
          <span class="day-num">{{ d.day }}</span>
        </div>
        <!-- Current month days -->
        <div
          v-for="day in daysInMonth"
          :key="day"
          class="day-cell"
          :class="{today:isToday(day),selected:isSelected(day)}"
          @click="selectDay(day)"
          @dblclick="onMonthDayDblClick(day)"
        >
          <span class="day-num">{{ day }}</span>
          <div class="day-events">
            <EventChip
              v-for="ev in eventsForDay(day).slice(0,3)"
              :key="ev.id"
              :title="eventChipTitle(ev)"
              :time="ev.allDay ? undefined : formatEventTime(ev.startAt)"
              :all-day="ev.allDay"
              :color="eventChipColor(ev)"
              @click="onEventClick(ev.id)"
            />
          </div>
          <span v-if="eventsForDay(day).length>3" class="more-events">+{{ eventsForDay(day).length-3 }} more</span>
        </div>
        <!-- Next month days -->
        <div
          v-for="d in nextMonthDays"
          :key="'n'+d.year+'-'+d.month+'-'+d.day"
          class="day-cell adjacent"
          @click="navigateToMonth(d.month, d.year, d.day)"
        >
          <span class="day-num">{{ d.day }}</span>
        </div>
      </div>
    </div>

    <!-- Week View -->
    <div v-else-if="viewMode==='week'" class="week-view">
      <!-- Single scroll container — header + grid share same width, no scrollbar offset -->
      <div ref="weekScrollEl" class="week-scroll">
        <!-- Sticky header sticks inside the scroll container -->
        <div class="week-sticky">
          <div class="week-headers">
            <div class="week-time-gutter" />
            <button
              v-for="d in weekDays"
              :key="d.date.toISOString()"
              type="button"
              class="week-col-header"
              :class="{ today: d.isToday }"
              :title="`Open ${d.dayName} ${d.label}`"
              :aria-label="`Open ${d.date.toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric'})}`"
              @click="openDayFromWeek(d.date)"
            >
              <span class="week-day-name">{{ d.dayName }}</span>
              <span class="week-day-num">{{ d.label }}</span>
            </button>
          </div>
          <div v-if="hasAllDayEvents" class="week-all-day">
            <span class="week-all-day-label">All day</span>
            <div v-for="d in weekDays" :key="'ad-'+d.date.toISOString()" class="week-all-day-cell">
              <EventChip v-for="ev in allDayEventsForDate(d.date)" :key="ev.id" :title="eventChipTitle(ev)" :all-day="true" :color="eventChipColor(ev)" @click="onEventClick(ev.id)" />
            </div>
          </div>
        </div>
        <div class="week-body">
          <!-- Today accent strip — absolute, full scroll-body height, behind everything -->
          <div v-if="isCurrentWeek" class="week-today-strip" :style="{ '--day-idx': todayDayIdx }" />
          <div class="week-grid">
            <template v-for="hour in hoursOfDay" :key="'h-'+hour">
              <div class="week-time-label" :class="{ 'is-off-hours': hour < 7 || hour >= 20 }">{{ hour % 12 || 12 }}{{ hour >= 12 ? 'pm' : 'am' }}</div>
              <div v-for="d in weekDays" :key="d.date.toISOString()+'-'+hour" class="week-hour-cell" :class="{ 'is-off-hours': hour < 7 || hour >= 20 }" />
            </template>
            <div v-if="isCurrentWeek" class="week-now-line" :style="{ top: currentTimePx + 'px', '--day-idx': todayDayIdx }" />
          </div>
          <div class="week-events-layer">
            <div class="week-gutter-filler" />
            <div
              v-for="(d, idx) in weekDays"
              :key="'ec-'+d.date.toISOString()"
              class="week-event-col"
              :style="{ gridColumn: idx + 2 }"
              @click.self="onWeekDayClick(d.date, $event)"
            >
              <button
                v-for="item in timedEventLayoutForDate(d.date)"
                :key="item.event.id"
                type="button"
                class="week-event-block"
                :class="{ 'is-compact': item.compact }"
                :style="timedEventStyle(item)"
                :title="eventBlockTooltip(item.event, item.timeLabel)"
                :aria-label="eventBlockTooltip(item.event, item.timeLabel)"
                :data-lane="item.lane"
                :data-lanes="item.lanes"
                @click.stop="onEventClick(item.event.id)"
              >
                <span class="week-event__time">{{ item.timeLabel }}</span>
                <span class="week-event__title">{{ item.event.title }}</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Day View -->
    <div v-else class="day-view">
      <div ref="dayScrollEl" class="day-scroll">
        <div class="day-sticky">
          <div class="day-banner" :class="{ today: isSelectedToday }">
            <div class="day-banner__date">
              <span class="day-banner-dayname">{{ dayNames[selectedDate.getDay()] }}</span>
              <span class="day-banner-date">{{ selectedDate.getDate() }}</span>
              <span class="day-banner-month">{{ selectedDate.toLocaleDateString('en-US',{month:'long',year:'numeric'}) }}</span>
            </div>
            <div class="day-banner__meta">
              <span v-if="isSelectedToday" class="day-banner-badge">Today</span>
              <span v-if="isSelectedToday" class="day-banner-now">
                <span class="day-banner-now-dot" aria-hidden="true" />Now {{ currentTimeLabel }}
              </span>
              <span class="day-banner-count">{{ selectedDayEventLabel }}</span>
            </div>
          </div>
          <div v-if="allDayEventsForDate(selectedDate).length" class="day-all-day">
            <span class="day-all-day-label">All day</span>
            <div class="day-all-day-cell">
              <EventChip v-for="ev in allDayEventsForDate(selectedDate)" :key="ev.id" :title="eventChipTitle(ev)" :all-day="true" :color="eventChipColor(ev)" @click="onEventClick(ev.id)" />
            </div>
          </div>
        </div>
        <div class="day-body">
          <div class="day-grid">
            <template v-for="hour in hoursOfDay" :key="'dh-'+hour">
              <div class="day-time-label" :class="{ 'is-off-hours': hour < 7 || hour >= 20 }">{{ hour % 12 || 12 }}{{ hour >= 12 ? 'pm' : 'am' }}</div>
              <div class="day-hour-cell" :class="{ 'is-off-hours': hour < 7 || hour >= 20 }" />
            </template>
            <div v-if="isSelectedToday" class="day-now-line" :style="{ top: currentTimePx + 'px' }" />
          </div>
          <div class="day-events-layer">
            <div class="day-gutter-filler" />
            <div class="day-event-col" @click.self="onWeekDayClick(selectedDate, $event)">
              <button
                v-for="item in timedEventLayoutForDate(selectedDate)"
                :key="item.event.id"
                type="button"
                class="day-event-block"
                :class="{ 'is-compact': item.compact }"
                :style="timedEventStyle(item)"
                :title="eventBlockTooltip(item.event, item.timeLabel)"
                :aria-label="eventBlockTooltip(item.event, item.timeLabel)"
                :data-lane="item.lane"
                :data-lanes="item.lanes"
                @click.stop="onEventClick(item.event.id)"
              >
                <span class="day-event__time">{{ item.timeLabel }}</span>
                <span class="day-event__title">{{ item.event.title }}</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Skeleton -->
    <Transition name="skeleton-fade">
      <div v-if="loading" class="skeleton-grid" :class="`skeleton-grid--${viewMode}`">
        <template v-if="viewMode === 'month'">
          <div v-for="i in 7" :key="'sh-'+i" class="skeleton-header" />
          <div v-for="i in 35" :key="'sc-'+i" class="skeleton-cell" />
        </template>
        <div v-else class="skeleton-timeline">
          <div v-for="i in 10" :key="'st-'+i" class="skeleton-time-row" />
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.calendar-view{display:flex;flex-direction:column;height:100%;position:relative}
.calendar-toolbar{display:flex;align-items:center;justify-content:space-between;padding-bottom:var(--space-4);flex-shrink:0}
.calendar-nav{display:flex;align-items:center;gap:var(--space-2)}
.nav-label{font-size:var(--text-title-size);font-weight:var(--font-weight-regular);white-space:nowrap}
.nav-arrow{display:flex;align-items:center;justify-content:center;width:36px;height:36px;border:none;border-radius:var(--radius-full);background:var(--color-bgSubtle);color:var(--color-textSecondary);cursor:pointer;transition:all var(--duration-fast) cubic-bezier(0.25,0.46,0.45,0.94)}
.nav-arrow:hover{background:var(--color-bgElevated);transform:scale(1.08)}
.nav-arrow:active{transform:scale(0.92);transition-duration:60ms}
.nav-arrow:focus-visible{outline:2px solid var(--color-primary);outline-offset:2px}
.calendar-actions{display:flex;align-items:center;gap:var(--space-3)}
.text-btn{border:none;background:none;color:var(--color-primary);font-size:var(--text-body-size);font-family:var(--font-family);cursor:pointer;padding:var(--space-1) var(--space-2);border-radius:var(--radius-sm);transition:background var(--duration-fast)}
.text-btn:hover{background:var(--color-bgSubtle)}
.text-btn:focus-visible{outline:2px solid var(--color-primary);outline-offset:2px}

/* Month View */
.month-view{display:flex;flex-direction:column;flex:1;min-height:0}

.day-headers{display:grid;grid-template-columns:repeat(7,1fr);gap:var(--space-1);flex-shrink:0;margin-bottom:var(--space-1)}

/* Day headers — compact, vertically centered */
.day-header{display:flex;align-items:center;justify-content:center;padding:var(--space-1) var(--space-1);border-radius:var(--radius-sm);font-size:var(--text-micro-size);font-weight:var(--font-weight-medium);color:var(--color-textPrimary);text-transform:uppercase;letter-spacing:0.04em;background:var(--color-accent-lighter)}

/* Month Grid — data rows fill available height */
.month-grid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));grid-auto-rows:minmax(0,1fr);flex:1;gap:var(--space-1);min-height:0}

/* Day cell — card treatment */
.day-cell{padding:5px 6px;background:var(--color-bgElevated);border-radius:var(--radius-sm);box-shadow:0 1px 0 0 var(--shadow-lip),0 2px 6px -2px var(--shadow-drop);cursor:pointer;transition:background var(--duration-fast),transform var(--duration-fast),box-shadow var(--duration-fast);min-width:0;min-height:0;overflow:hidden;display:flex;flex-direction:column}
.day-cell:active{transform:scale(0.97);transition-duration:60ms}
.day-cell:hover{background:var(--color-bgSurface);box-shadow:0 2px 0 0 var(--shadow-lip),0 4px 12px -2px var(--shadow-drop)}
.day-cell.adjacent{opacity:0.3;box-shadow:none;background:var(--color-bgSubtle);cursor:pointer}
.day-cell.adjacent:hover{opacity:0.5;background:var(--color-bgSurface)}

/* Today and selected cards carry an accent tint plus a strong accent ring. */
.day-cell.today{background:color-mix(in srgb,var(--color-accent-base) 14%,var(--color-bgElevated));box-shadow:inset 0 0 0 2px var(--color-accent-base),0 2px 6px -2px var(--shadow-drop)}
.day-cell.today:hover{background:color-mix(in srgb,var(--color-accent-base) 20%,var(--color-bgElevated))}
.day-cell.selected{background:color-mix(in srgb,var(--color-accent-base) 26%,var(--color-bgElevated));box-shadow:inset 0 0 0 2px var(--color-accent-dark),0 2px 8px -2px var(--shadow-accent-drop)}
.day-cell.selected:hover{background:color-mix(in srgb,var(--color-accent-base) 32%,var(--color-bgElevated))}
.day-cell.selected.today{background:color-mix(in srgb,var(--color-accent-base) 36%,var(--color-bgElevated));box-shadow:inset 0 0 0 3px var(--color-accent-dark),0 3px 10px -2px var(--shadow-accent-drop)}
@keyframes today-pulse{0%,70%,100%{opacity:0;transform:scale(0.85)}35%{opacity:0.40;transform:scale(1.15)}}

/* Day number as a distinct pill badge */
.day-num{display:inline-flex;align-items:center;justify-content:center;min-width:20px;height:20px;padding:0 var(--space-1);border-radius:var(--radius-xs);background:var(--color-bgSubtle);font-size:var(--text-label-size);font-weight:var(--font-weight-medium);align-self:flex-start;margin-bottom:2px;line-height:1;flex-shrink:0}
.day-cell.today .day-num,
.day-cell.selected .day-num{background:var(--color-accent-dark);color:var(--color-on-accent,var(--color-textInverse))}
.day-cell.today .day-num{width:22px;height:22px;min-width:unset;border-radius:var(--radius-full);position:relative}
.day-cell.today .day-num::after{content:'';position:absolute;inset:-6px;border-radius:var(--radius-full);background:var(--color-accent-glow);opacity:0;animation:today-pulse 2.8s cubic-bezier(0.25,0.46,0.45,0.94) infinite;animation-delay:1.2s;z-index:-1}
.day-events{display:flex;flex-direction:column;gap:2px;flex:1;min-width:0;min-height:0;overflow:hidden}
.more-events{flex-shrink:0;font-size:var(--text-micro-size);color:var(--color-textSecondary);padding:2px 5px 0}

/* Week View */
.week-view{display:flex;flex-direction:column;flex:1;min-height:0}
.week-scroll{flex:1;min-height:0;overflow-y:auto}

/* Sticky header — lives inside the scroll container so it shares the same width as the grid */
.week-sticky{position:sticky;top:0;z-index:10;background:var(--color-bgBase);border-bottom:1px solid var(--color-border)}

/* ── Column headers ── */
.week-headers{display:grid;grid-template-columns:48px repeat(7,1fr);column-gap:var(--space-1);flex-shrink:0;padding-bottom:var(--space-1)}
.week-time-gutter{grid-column:1}

.week-col-header{
  display:flex;
  flex-direction:column;
  align-items:center;
  justify-content:center;
  gap:1px;
  min-width:0;
  padding:var(--space-1) var(--space-1) var(--space-2);
  border:none;
  border-bottom:2px solid transparent;
  border-radius:var(--radius-sm) var(--radius-sm) 0 0;
  background:transparent;
  color:var(--color-textSecondary);
  font-family:var(--font-family);
  appearance:none;
  cursor:pointer;
  transition:background var(--duration-fast),color var(--duration-fast),border-color var(--duration-fast);
}
.week-col-header:hover{background:var(--color-bgSubtle);color:var(--color-textPrimary)}
.week-col-header:focus-visible{outline:2px solid var(--color-primary);outline-offset:-2px}
.week-col-header.today{
  background:color-mix(in srgb,var(--color-accent-base) 12%,transparent);
  border-bottom-color:var(--color-accent-dark);
  color:var(--color-textPrimary);
}
.week-col-header.today:hover{background:color-mix(in srgb,var(--color-accent-base) 18%,transparent)}
.week-day-name{
  font-size:var(--text-micro-size);
  font-weight:var(--font-weight-medium);
  color:var(--color-textMuted);
  text-transform:uppercase;
  letter-spacing:.04em;
  line-height:1.2;
}
.week-day-num{
  display:inline-flex;
  align-items:center;
  justify-content:center;
  min-width:1.5em;
  height:1.5em;
  padding:0 .3em;
  border-radius:var(--radius-full);
  font-size:var(--text-heading-size);
  font-weight:var(--font-weight-medium);
  line-height:1;
  font-variant-numeric:tabular-nums;
}
.week-col-header.today .week-day-num{background:var(--color-accent-dark);color:var(--color-on-accent,var(--color-textInverse))}
.week-col-header.today .week-day-name{color:var(--color-textSecondary)}

/* ── All-day events bar ── */
.week-all-day{
  display:grid;
  grid-template-columns:48px repeat(7,1fr);
  column-gap:var(--space-1);
  padding:var(--space-1) 0;
  background:color-mix(in srgb,var(--color-bgSubtle) 55%,transparent);
  border-top:1px solid var(--color-border);
}
.week-all-day-label{
  grid-column:1;
  align-self:start;
  justify-self:end;
  padding:2px var(--space-1) 0 0;
  font-size:calc(var(--text-micro-size) * 0.85);
  color:var(--color-textMuted);
  text-transform:uppercase;
  letter-spacing:.02em;
  line-height:1.3;
  white-space:nowrap;
}
.week-all-day-cell{display:flex;flex-direction:column;gap:2px;min-height:0}

/* ── Body: time grid + events overlay ── */
.week-body{position:relative}

.week-grid{
  display:grid;
  grid-template-columns:48px repeat(7,1fr);
  column-gap:var(--space-1);
  grid-auto-rows:56px;
  position:relative;
  --_cw:calc((100% - 76px) / 7);
}

.week-time-label{
  display:flex;
  align-items:flex-start;
  justify-content:flex-end;
  padding:var(--space-1) var(--space-2) 0 0;
  border-radius:0 var(--radius-xs) var(--radius-xs) 0;
  font-size:var(--text-micro-size);
  color:var(--color-textSecondary);
  font-variant-numeric:tabular-nums;
  transition:background var(--duration-fast);
}

/* Hour cell — clean, minimal */
.week-hour-cell{
  border-bottom:1px solid color-mix(in srgb,var(--color-border) 70%,transparent);
  transition:background var(--duration-fast);
}
.week-hour-cell:hover{background:var(--color-bgSubtle)}
.week-time-label.is-off-hours,
.week-hour-cell.is-off-hours{background:color-mix(in srgb,var(--color-bgSubtle) 42%,transparent)}

/* Today column accent strip — absolute, full height of scroll body, behind grid */
/* col-gap = 4px (--space-1), 7 gaps total = 28px; col-width = (100% - 48px - 28px)/7 */
.week-today-strip{
  --_cw:calc((100% - 76px) / 7);
  position:absolute;top:0;bottom:0;
  left:calc(52px + var(--day-idx,0) * (4px + var(--_cw)));
  width:var(--_cw);
  border-radius:0 0 var(--radius-sm) var(--radius-sm);
  background:color-mix(in srgb,var(--color-accent-base) 9%,transparent);
  pointer-events:none;
  z-index:0;
}

/* Current time line — only over today's column */
.week-now-line{
  position:absolute;
  left:calc(52px + var(--day-idx,0) * (4px + var(--_cw)));
  width:var(--_cw);
  height:2px;
  background:var(--color-accent-dark);
  z-index:5;
  pointer-events:none;
  transform:translateY(-1px);
}
.week-now-line::before,
.day-now-line::before{
  content:'';position:absolute;left:-5px;top:-4px;
  width:10px;height:10px;border-radius:50%;
  background:var(--color-accent-dark);
}

/* ── Events overlay ── */
.week-events-layer{position:absolute;inset:0;display:grid;grid-template-columns:48px repeat(7,1fr);grid-template-rows:1fr;column-gap:var(--space-1);pointer-events:none}
.week-gutter-filler{grid-column:1}
.week-event-col{position:relative;grid-row:1/-1;pointer-events:auto;cursor:pointer}

/* Timed event cards are shared by week and day so both views feel identical. */
.week-event-block,
.day-event-block{
  position:absolute;
  border-radius:var(--radius-xs);
  border:none;
  padding:2px 6px;
  overflow:hidden;
  background:color-mix(in srgb,var(--event-color) 22%,var(--color-bgElevated));
  color:var(--color-textPrimary);
  font-family:var(--font-family);
  font-size:var(--text-label-size);
  line-height:1.25;
  text-align:left;
  min-height:20px;
  display:flex;
  flex-direction:column;
  gap:1px;
  cursor:pointer;
  appearance:none;
  transition:box-shadow var(--duration-fast),background var(--duration-fast),z-index 0s;
  z-index:1;
}
.week-event-block:hover,
.day-event-block:hover{
  background:color-mix(in srgb,var(--event-color) 28%,var(--color-bgElevated));
  box-shadow:0 4px 12px -4px color-mix(in srgb,var(--event-color) 55%,transparent);
  z-index:3;
}
.week-event-block:focus-visible,
.day-event-block:focus-visible{outline:2px solid var(--color-primary);outline-offset:1px;z-index:4}
.week-event__time,
.day-event__time{
  font-size:var(--text-micro-size);
  color:var(--color-textSecondary);
  font-variant-numeric:tabular-nums;
  flex-shrink:0;
  line-height:1.2;
}
.week-event__title,
.day-event__title{
  min-width:0;
  overflow:hidden;
  text-overflow:ellipsis;
  white-space:nowrap;
  font-size:var(--text-label-size);
  line-height:1.25;
}
.week-event-block.is-compact,
.day-event-block.is-compact{
  flex-direction:row;
  align-items:center;
  gap:var(--space-2);
  padding:1px 5px;
}
.week-event-block.is-compact .week-event__time,
.day-event-block.is-compact .day-event__time{display:none}
.week-event-block.is-compact .week-event__title,
.day-event-block.is-compact .day-event__title{flex:1}

/* ── Day View ── */
.day-view{display:flex;flex-direction:column;flex:1;min-height:0}
.day-scroll{flex:1;min-height:0;overflow-y:auto;width:100%}
.day-sticky{position:sticky;top:0;z-index:10;background:var(--color-bgBase);border-bottom:1px solid var(--color-border)}
.day-banner{
  display:flex;
  align-items:center;
  justify-content:space-between;
  flex-wrap:wrap;
  gap:var(--space-3);
  row-gap:var(--space-1);
  padding:var(--space-2) var(--space-5);
  background:color-mix(in srgb,var(--color-bgSubtle) 55%,transparent);
  flex-shrink:0;
}
.day-banner.today{background:color-mix(in srgb,var(--color-accent-base) 12%,transparent)}
.day-banner__date{display:flex;align-items:baseline;gap:var(--space-2);min-width:0;flex-wrap:wrap}
.day-banner-dayname{font-size:var(--text-title-size);font-weight:var(--font-weight-regular);line-height:1.2}
.day-banner-date{font-size:var(--text-display-size);font-weight:var(--font-weight-thin);line-height:1;font-variant-numeric:tabular-nums}
.day-banner-month{font-size:var(--text-body-size);color:var(--color-textMuted)}
.day-banner.today .day-banner-month{color:var(--color-textSecondary)}
.day-banner__meta{display:flex;align-items:center;gap:var(--space-2);flex-wrap:wrap;flex-shrink:0}
.day-banner-badge{
  padding:1px 8px;
  border-radius:var(--radius-full);
  background:var(--color-accent-dark);
  color:var(--color-on-accent,var(--color-textInverse));
  font-size:var(--text-micro-size);
  font-weight:var(--font-weight-medium);
  letter-spacing:.04em;
  text-transform:uppercase;
  line-height:1.6;
}
.day-banner-count{font-size:var(--text-label-size);color:var(--color-textMuted);white-space:nowrap}
.day-banner-now{
  display:inline-flex;
  align-items:center;
  gap:6px;
  font-size:var(--text-label-size);
  color:var(--color-textSecondary);
  font-variant-numeric:tabular-nums;
  white-space:nowrap;
}
.day-banner-now-dot{
  width:7px;
  height:7px;
  border-radius:50%;
  background:var(--color-accent-dark);
  box-shadow:0 0 0 3px color-mix(in srgb,var(--color-accent-base) 28%,transparent);
}
.day-all-day{
  display:grid;
  grid-template-columns:48px 1fr;
  column-gap:var(--space-2);
  padding:var(--space-1) 0;
  background:color-mix(in srgb,var(--color-bgSubtle) 55%,transparent);
  border-top:1px solid var(--color-border);
}
.day-all-day-label{
  grid-column:1;
  align-self:start;
  justify-self:end;
  padding:2px var(--space-1) 0 0;
  font-size:calc(var(--text-micro-size) * 0.85);
  color:var(--color-textMuted);
  text-transform:uppercase;
  letter-spacing:.02em;
  line-height:1.3;
  white-space:nowrap;
}
.day-all-day-cell{display:flex;flex-direction:column;gap:2px}
.day-body{position:relative}
.day-grid{display:grid;grid-template-columns:48px 1fr;column-gap:var(--space-2);grid-auto-rows:56px;position:relative}
.day-time-label{
  display:flex;
  align-items:flex-start;
  justify-content:flex-end;
  padding:var(--space-1) var(--space-2) 0 0;
  border-radius:0 var(--radius-xs) var(--radius-xs) 0;
  font-size:var(--text-micro-size);
  color:var(--color-textSecondary);
  font-variant-numeric:tabular-nums;
  transition:background var(--duration-fast);
}
.day-hour-cell{
  border-bottom:1px solid color-mix(in srgb,var(--color-border) 70%,transparent);
  transition:background var(--duration-fast);
}
.day-hour-cell:hover{background:var(--color-bgSubtle)}
.day-time-label.is-off-hours,
.day-hour-cell.is-off-hours{background:color-mix(in srgb,var(--color-bgSubtle) 42%,transparent)}
.day-now-line{
  position:absolute;
  left:calc(48px + var(--space-2));
  right:0;
  height:2px;
  background:var(--color-accent-dark);
  z-index:5;
  pointer-events:none;
  transform:translateY(-1px);
}
.day-events-layer{position:absolute;inset:0;display:grid;grid-template-columns:48px 1fr;grid-template-rows:1fr;column-gap:var(--space-2);pointer-events:none}
.day-gutter-filler{grid-column:1}
.day-event-col{position:relative;grid-column:2;grid-row:1/-1;pointer-events:auto;cursor:pointer}

/* Skeleton */
.skeleton-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:1px;background:var(--color-border);border-radius:var(--radius-md);overflow:hidden;position:absolute;inset:0;top:56px}
.skeleton-grid--week,
.skeleton-grid--day{display:block;background:var(--color-bgBase);border-radius:0}
.skeleton-timeline{display:flex;flex-direction:column;gap:1px}
.skeleton-time-row{height:56px;background:var(--color-bgSurface);position:relative;overflow:hidden}
.skeleton-header{height:32px;background:var(--color-bgSurface)}
.skeleton-cell{min-height:100px;background:var(--color-bgSurface);position:relative;overflow:hidden}
.skeleton-cell::after,
.skeleton-time-row::after{content:'';position:absolute;inset:0;background:linear-gradient(90deg,transparent 0%,var(--shadow-shine) 45%,var(--shadow-shine) 50%,var(--shadow-shine) 55%,transparent 100%);background-size:250% 100%;animation:shimmer 1.8s ease-in-out infinite}
@keyframes shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}
.skeleton-fade-enter-active{transition:opacity var(--duration-base) ease}
.skeleton-fade-leave-active{transition:opacity var(--duration-slow) ease}
.skeleton-fade-enter-from,.skeleton-fade-leave-to{opacity:0}

/* Nav transitions */
.nav-forward-enter-active,.nav-back-enter-active{transition:opacity var(--duration-fast) cubic-bezier(0.25,0.46,0.45,0.94),transform var(--duration-fast) cubic-bezier(0.25,0.46,0.45,0.94)}
.nav-forward-leave-active,.nav-back-leave-active{transition:opacity var(--duration-fast) ease-in,transform var(--duration-fast) ease-in}
.nav-forward-enter-from{opacity:0;transform:translateX(16px)}
.nav-forward-leave-to{opacity:0;transform:translateX(-16px)}
.nav-back-enter-from{opacity:0;transform:translateX(-16px)}
.nav-back-leave-to{opacity:0;transform:translateX(16px)}

</style>

<style>
.dark .day-header {
  background: var(--color-accent-dark);
  color: var(--color-textPrimary);
}
</style>
