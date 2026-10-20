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
  await Promise.all([
    loadMembers(),
    prefetchAround(currentYear.value, currentMonth.value),
  ])
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

// Pre-bucket events by date+hour key for O(1) lookup per cell
const eventsByHourKey = computed(() => {
  const map = new Map<string, Event[]>()
  for (const ev of expandedEvents.value) {
    const s = new Date(ev.startAt)
    const e = ev.endAt ? new Date(ev.endAt) : s
    if (e <= s) continue
    const cursor = new Date(s)
    while (cursor < e) {
      const key = dateHourKey(cursor)
      const bucket = map.get(key)
      if (bucket) bucket.push(ev)
      else map.set(key, [ev])
      cursor.setHours(cursor.getHours() + 1)
    }
  }
  return map
})

function dateHourKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}|${d.getHours()}`
}

function eventsForHour(date: Date, hour: number) {
  const d = new Date(date)
  d.setHours(hour, 0, 0, 0)
  return eventsByHourKey.value.get(dateHourKey(d)) ?? []
}

// Auto-scroll to 6am when switching to week view
function scrollTo6am() {
  nextTick(() => {
    const el = weekScrollEl.value
    if (!el) return
    el.scrollTop = WEEK_ROW_HEIGHT * 6
  })
}

watch(viewMode, (v) => { if (v === "week") scrollTo6am() })

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

function dayClampedStart(ev: Event, date: Date): Date {
  const start = new Date(ev.startAt)
  const dayStart = new Date(date); dayStart.setHours(0, 0, 0, 0)
  return start < dayStart ? dayStart : start
}

function eventPositionStyle(ev: Event, date: Date) {
  const start = new Date(ev.startAt)
  const end = new Date(ev.endAt ?? ev.startAt)
  const dayStart = new Date(date); dayStart.setHours(0, 0, 0, 0)
  const dayEnd = new Date(dayStart); dayEnd.setDate(dayEnd.getDate() + 1)
  const clampedStart = start < dayStart ? dayStart : start
  const clampedEnd = end > dayEnd ? dayEnd : end
  const startMinutes = clampedStart.getHours() * 60 + clampedStart.getMinutes()
  const duration = Math.max((clampedEnd.getTime() - clampedStart.getTime()) / 60000, 15)
  return {
    top:    `${(startMinutes / 60) * WEEK_ROW_HEIGHT}px`,
    height: `${(duration   / 60) * WEEK_ROW_HEIGHT}px`,
  }
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

function scrollDayTo6am() {
  nextTick(() => {
    if (dayScrollEl.value) dayScrollEl.value.scrollTop = WEEK_ROW_HEIGHT * 6
  })
}

watch(viewMode, (v) => { if (v === "day") scrollDayTo6am() })

function onEventClick(eventId: string) {
  ui.openDrawer("event-detail", eventId.split("::")[0])
}

function handleMonthNavigate(month: number, year: number, day?: number) {
  navigateToMonth(month, year, day)
  handleNavChange(year, month)
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
            <div v-for="d in weekDays" :key="d.date.toISOString()" class="week-col-header" :class="{ today: d.isToday }">
              <span class="week-day-name">{{ d.dayName }}</span>
              <span class="week-day-num">{{ d.label }}</span>
            </div>
          </div>
          <div v-if="hasAllDayEvents" class="week-all-day">
            <div class="week-time-gutter" />
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
              <div class="week-time-label">{{ hour % 12 || 12 }}{{ hour >= 12 ? 'pm' : 'am' }}</div>
              <div v-for="d in weekDays" :key="d.date.toISOString()+'-'+hour" class="week-hour-cell" />
            </template>
            <div v-if="isCurrentWeek" class="week-now-line" :style="{ top: currentTimePx + 'px' }" />
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
              <div
                v-for="ev in timedEventsForDate(d.date)"
                :key="ev.id"
                class="week-event-block"
                :style="{ top: eventPositionStyle(ev, d.date).top, height: eventPositionStyle(ev, d.date).height, '--event-color': eventChipColor(ev) }"
                @click.stop="onEventClick(ev.id)"
              >
                <span class="week-event__time">{{ formatEventTime(dayClampedStart(ev, d.date).toISOString()) }}</span>
                <span class="week-event__title">{{ eventChipTitle(ev) }}</span>
              </div>
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
            <span class="day-banner-dayname">{{ dayNames[selectedDate.getDay()] }}</span>
            <span class="day-banner-date">{{ selectedDate.getDate() }}</span>
            <span class="day-banner-month">{{ selectedDate.toLocaleDateString('en-US',{month:'long',year:'numeric'}) }}</span>
          </div>
          <div v-if="allDayEventsForDate(selectedDate).length" class="day-all-day">
            <div class="day-time-gutter" />
            <div class="day-all-day-cell">
              <EventChip v-for="ev in allDayEventsForDate(selectedDate)" :key="ev.id" :title="eventChipTitle(ev)" :all-day="true" :color="eventChipColor(ev)" @click="onEventClick(ev.id)" />
            </div>
          </div>
        </div>
        <div class="day-body">
          <div class="day-grid">
            <template v-for="hour in hoursOfDay" :key="'dh-'+hour">
              <div class="day-time-label">{{ hour % 12 || 12 }}{{ hour >= 12 ? 'pm' : 'am' }}</div>
              <div class="day-hour-cell" />
            </template>
            <div v-if="isSelectedToday" class="day-now-line" :style="{ top: currentTimePx + 'px' }" />
          </div>
          <div class="day-events-layer">
            <div class="day-gutter-filler" />
            <div class="day-event-col" @click.self="onWeekDayClick(selectedDate, $event)">
              <div
                v-for="ev in timedEventsForDate(selectedDate)"
                :key="ev.id"
                class="day-event-block"
                :style="{ top: eventPositionStyle(ev, selectedDate).top, height: eventPositionStyle(ev, selectedDate).height, '--event-color': eventChipColor(ev) }"
                @click.stop="onEventClick(ev.id)"
              >
                <span class="day-event__time">{{ formatEventTime(dayClampedStart(ev, selectedDate).toISOString()) }}</span>
                <span class="day-event__title">{{ eventChipTitle(ev) }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Skeleton -->
    <Transition name="skeleton-fade">
      <div v-if="loading" class="skeleton-grid">
        <div v-for="i in 7" :key="'sh-'+i" class="skeleton-header" />
        <div v-for="i in 35" :key="'sc-'+i" class="skeleton-cell" />
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

.day-cell.selected{box-shadow:inset 0 0 0 2px var(--color-primary)}
@keyframes today-pulse{0%,70%,100%{opacity:0;transform:scale(0.85)}35%{opacity:0.40;transform:scale(1.15)}}

/* Day number as a distinct pill badge */
.day-num{display:inline-flex;align-items:center;justify-content:center;min-width:20px;height:20px;padding:0 var(--space-1);border-radius:var(--radius-xs);background:var(--color-bgSubtle);font-size:var(--text-label-size);font-weight:var(--font-weight-medium);align-self:flex-start;margin-bottom:2px;line-height:1;flex-shrink:0}
.day-cell.today .day-num{width:22px;height:22px;min-width:unset;border-radius:var(--radius-full);background:var(--color-accent-dark);color:var(--color-textInverse);position:relative}
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

.week-col-header{display:flex;flex-direction:column;align-items:center;justify-content:center;padding:var(--space-1);border-radius:var(--radius-sm);font-size:var(--text-body-size);font-weight:var(--font-weight-medium);background:var(--color-accent-lighter);color:var(--color-textPrimary);transition:background var(--duration-fast);border-bottom:2px solid transparent}
.week-col-header.today{background:var(--color-accent-dark);color:var(--color-textInverse)}
.week-day-name{font-size:var(--text-micro-size);opacity:0.7;text-transform:uppercase;letter-spacing:0.04em}
.week-day-num{font-size:var(--text-heading-size);line-height:1}

/* ── All-day events bar ── */
.week-all-day{display:grid;grid-template-columns:48px repeat(7,1fr);column-gap:var(--space-1);padding-bottom:var(--space-1);padding-top:var(--space-1)}
.week-all-day-cell{display:flex;flex-direction:column;gap:2px;min-height:0}

/* ── Body: time grid + events overlay ── */
.week-body{position:relative}

.week-grid{display:grid;grid-template-columns:48px repeat(7,1fr);column-gap:var(--space-1);grid-auto-rows:56px;position:relative}

.week-time-label{display:flex;align-items:flex-start;justify-content:flex-end;padding:var(--space-1) var(--space-2) 0 0;font-size:var(--text-micro-size);color:var(--color-textMuted);font-variant-numeric:tabular-nums}

/* Hour cell — clean, minimal */
.week-hour-cell{border-bottom:1px solid var(--color-border)}
.week-hour-cell:hover{background:var(--color-bgSubtle)}

/* Today column accent strip — absolute, full height of scroll body, behind grid */
/* col-gap = 4px (--space-1), 7 gaps total = 28px; col-width = (100% - 48px - 28px)/7 */
.week-today-strip{
  --_cw: calc((100% - 76px) / 7);
  position:absolute;top:0;bottom:0;
  left:calc(52px + var(--day-idx,0) * (4px + var(--_cw)));
  width:var(--_cw);
  background:var(--color-accent-lighter);opacity:0.45;pointer-events:none;z-index:0
}

/* Current time line — positioned inside .week-grid (position:relative) */
.week-now-line{position:absolute;left:calc(48px + var(--space-1));right:0;height:2px;background:var(--color-accent-dark);z-index:5;pointer-events:none;transform:translateY(-1px)}
.week-now-line::before{content:'';position:absolute;left:-5px;top:-4px;width:10px;height:10px;border-radius:50%;background:var(--color-accent-dark)}

/* ── Events overlay ── */
.week-events-layer{position:absolute;inset:0;display:grid;grid-template-columns:48px repeat(7,1fr);grid-template-rows:1fr;column-gap:var(--space-1);pointer-events:none}
.week-gutter-filler{grid-column:1}
.week-event-col{position:relative;grid-row:1/-1;pointer-events:auto;cursor:pointer}

.week-event-block{position:absolute;left:2px;right:2px;border-radius:var(--radius-xs);padding:1px 4px;overflow:hidden;cursor:pointer;background:color-mix(in srgb,var(--event-color) 18%,var(--color-bgBase));border-left:3px solid var(--event-color);font-size:var(--text-label-size);line-height:1.3;min-height:14px;display:flex;flex-direction:column;gap:0;transition:box-shadow var(--duration-fast),z-index 0s;z-index:1}
.week-event-block:hover{box-shadow:0 2px 8px -2px color-mix(in srgb,var(--event-color) 50%,transparent);z-index:2}
.week-event__time{font-size:10px;opacity:0.65;font-variant-numeric:tabular-nums;flex-shrink:0}
.week-event__title{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

/* ── Day View ── */
.day-view{display:flex;flex-direction:column;flex:1;min-height:0}
.day-scroll{flex:1;min-height:0;overflow-y:auto;width:100%}
.day-sticky{position:sticky;top:0;z-index:10;background:var(--color-bgBase);border-bottom:1px solid var(--color-border)}
.day-banner{display:flex;align-items:baseline;justify-content:center;gap:var(--space-3);padding:var(--space-3) var(--space-6);background:var(--color-bgSubtle);flex-shrink:0}
.day-banner.today{background:linear-gradient(165deg,var(--color-accent-dark),var(--color-accent-darker));color:var(--color-textInverse)}
.day-banner-dayname{font-size:var(--text-title-size);font-weight:var(--font-weight-regular)}
.day-banner-date{font-size:var(--text-display-size);font-weight:var(--font-weight-thin)}
.day-banner-month{font-size:var(--text-body-size);opacity:0.7}
.day-all-day{display:grid;grid-template-columns:48px 1fr;column-gap:var(--space-2);padding:var(--space-1);border-top:1px solid var(--color-border)}
.day-time-gutter{grid-column:1}
.day-all-day-cell{display:flex;flex-direction:column;gap:2px}
.day-body{position:relative}
.day-grid{display:grid;grid-template-columns:48px 1fr;column-gap:var(--space-2);grid-auto-rows:56px;position:relative}
.day-time-label{display:flex;align-items:flex-start;justify-content:flex-end;padding:var(--space-1) var(--space-2) 0 0;font-size:var(--text-micro-size);color:var(--color-textMuted);font-variant-numeric:tabular-nums}
.day-hour-cell{border-bottom:1px solid var(--color-border)}
.day-hour-cell:hover{background:var(--color-bgSubtle)}
.day-now-line{position:absolute;left:calc(48px + var(--space-2));right:0;height:2px;background:var(--color-accent-dark);z-index:5;pointer-events:none;transform:translateY(-1px)}
.day-now-line::before{content:'';position:absolute;left:-5px;top:-4px;width:10px;height:10px;border-radius:50%;background:var(--color-accent-dark)}
.day-events-layer{position:absolute;inset:0;display:grid;grid-template-columns:48px 1fr;grid-template-rows:1fr;column-gap:var(--space-2);pointer-events:none}
.day-gutter-filler{grid-column:1}
.day-event-col{position:relative;grid-column:2;grid-row:1/-1;pointer-events:auto;cursor:pointer}
.day-event-block{position:absolute;left:2px;right:2px;border-radius:var(--radius-xs);padding:2px 6px;overflow:hidden;cursor:pointer;background:color-mix(in srgb,var(--event-color) 18%,var(--color-bgBase));border-left:3px solid var(--event-color);font-size:var(--text-label-size);line-height:1.3;min-height:14px;display:flex;flex-direction:column;gap:0;transition:box-shadow var(--duration-fast);z-index:1}
.day-event-block:hover{box-shadow:0 2px 8px -2px color-mix(in srgb,var(--event-color) 50%,transparent);z-index:2}
.day-event__time{font-size:10px;opacity:0.65;font-variant-numeric:tabular-nums;flex-shrink:0}
.day-event__title{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

/* Skeleton */
.skeleton-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:1px;background:var(--color-border);border-radius:var(--radius-md);overflow:hidden;position:absolute;inset:0;top:56px}
.skeleton-header{height:32px;background:var(--color-bgSurface)}
.skeleton-cell{min-height:100px;background:var(--color-bgSurface);position:relative;overflow:hidden}
.skeleton-cell::after{content:'';position:absolute;inset:0;background:linear-gradient(90deg,transparent 0%,var(--shadow-shine) 45%,var(--shadow-shine) 50%,var(--shadow-shine) 55%,transparent 100%);background-size:250% 100%;animation:shimmer 1.8s ease-in-out infinite}
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
.dark .day-header,
.dark .week-col-header {
  background: var(--color-accent-dark);
  color: var(--color-textPrimary);
}
</style>
