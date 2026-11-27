<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from "vue"
import { useEvents, type Event } from "@/composables/useEvents"
import { useMembers } from "@/composables/useMembers"
import { expandEvents } from "@/utils/recurrence"
import { memberColorHex, type MemberColor } from "@/types/household"
import {
  PhCalendarBlank,
  PhCaretDown,
  PhCaretLeft,
  PhCaretRight,
  PhCaretUp,
} from "@phosphor-icons/vue"

const emit = defineEmits<{ selectEvent: [id: string] }>()

const { events, initialized, prefetchAround } = useEvents()
const { members, ensureLoaded: loadMembers } = useMembers()

const now = ref(new Date())
const selectedDate = ref(new Date())
const monthExpanded = ref(true)

let nowInterval: ReturnType<typeof setInterval> | null = null

function startOfDay(d: Date): Date {
  const date = new Date(d)
  date.setHours(0, 0, 0, 0)
  return date
}

function getMonday(d: Date): Date {
  const date = startOfDay(d)
  const day = date.getDay()
  const diff = date.getDate() - day + (day === 0 ? -6 : 1)
  date.setDate(diff)
  return date
}

function addDays(d: Date, amount: number): Date {
  const date = new Date(d)
  date.setDate(date.getDate() + amount)
  return date
}

function addMonthsClamped(d: Date, amount: number): Date {
  const target = new Date(d.getFullYear(), d.getMonth() + amount, 1)
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate()
  target.setDate(Math.min(d.getDate(), lastDay))
  return target
}

function isSameDate(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

function dayKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
}

const monthStart = computed(
  () => new Date(selectedDate.value.getFullYear(), selectedDate.value.getMonth(), 1),
)

const monthGridStart = computed(() => getMonday(monthStart.value))

const monthRowCount = computed(() => {
  const daysInMonth = new Date(
    monthStart.value.getFullYear(),
    monthStart.value.getMonth() + 1,
    0,
  ).getDate()
  const leadingDays = (monthStart.value.getDay() + 6) % 7
  return Math.ceil((leadingDays + daysInMonth) / 7)
})

const UNASSIGNED_COLOR = "var(--color-borderStrong)"

function eventChipColor(ev: Pick<Event, "assigneeId">): string {
  if (!ev.assigneeId) return UNASSIGNED_COLOR
  const m = members.value.find(mem => mem.id === ev.assigneeId)
  if (!m) return UNASSIGNED_COLOR
  return m.color.startsWith("#") ? m.color : memberColorHex(m.color as MemberColor)
}

function assigneeName(ev: Pick<Event, "assigneeId">): string | null {
  if (!ev.assigneeId) return null
  return members.value.find(mem => mem.id === ev.assigneeId)?.name || null
}

function formatEventTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
}

const dayNames = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

const EXPAND_LEAD_DAYS = 31
const MAX_EVENT_DAYS = 366

const visibleRange = computed(() => ({
  from: addDays(monthGridStart.value, -1),
  to: addDays(monthGridStart.value, monthRowCount.value * 7 + 1),
}))

const expandedEvents = computed<Event[]>(() => {
  const { from, to } = visibleRange.value
  return expandEvents(events.value, addDays(from, -EXPAND_LEAD_DAYS), to)
})

const eventsByDay = computed(() => {
  const index = new Map<string, Event[]>()
  const { from, to } = visibleRange.value
  const min = from.getTime()
  const max = to.getTime()

  for (const ev of expandedEvents.value) {
    const start = new Date(ev.startAt)
    if (Number.isNaN(start.getTime())) continue

    let end = ev.endAt ? new Date(ev.endAt) : new Date(start)
    if (Number.isNaN(end.getTime()) || end.getTime() < start.getTime()) end = new Date(start)
    if (ev.allDay && end.getTime() <= start.getTime()) {
      end = new Date(start.getTime() + 1)
    }

    const cursor = startOfDay(start)
    const lastDay = startOfDay(end)
    if (cursor.getTime() < min) cursor.setTime(min)

    for (let i = 0; cursor.getTime() <= lastDay.getTime() && i < MAX_EVENT_DAYS; i++) {
      const t = cursor.getTime()
      if (t >= min && t <= max) {
        const key = dayKey(cursor)
        const list = index.get(key)
        if (list) list.push(ev)
        else index.set(key, [ev])
      }
      cursor.setDate(cursor.getDate() + 1)
    }
  }

  return index
})

function eventsForDate(date: Date): Event[] {
  return eventsByDay.value.get(dayKey(date)) ?? []
}

interface MonthCell {
  date: Date
  key: string
  day: number
  inMonth: boolean
  isToday: boolean
  isSelected: boolean
  dots: string[]
  eventCount: number
}

const monthCells = computed<MonthCell[]>(() => {
  const start = monthGridStart.value
  const total = monthRowCount.value * 7
  const cells: MonthCell[] = []

  for (let i = 0; i < total; i++) {
    const date = addDays(start, i)
    const dayEvents = eventsForDate(date)
    cells.push({
      date,
      key: dayKey(date),
      day: date.getDate(),
      inMonth:
        date.getMonth() === monthStart.value.getMonth() &&
        date.getFullYear() === monthStart.value.getFullYear(),
      isToday: isSameDate(date, now.value),
      isSelected: isSameDate(date, selectedDate.value),
      dots: dayEvents.slice(0, 3).map(eventChipColor),
      eventCount: dayEvents.length,
    })
  }

  return cells
})

function monthCellLabel(cell: MonthCell): string {
  const label = cell.date.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  })
  const count =
    cell.eventCount === 0
      ? "no events"
      : `${cell.eventCount} ${cell.eventCount === 1 ? "event" : "events"}`
  return `${label}, ${count}${cell.isSelected ? ", selected" : ""}`
}

const selectedWeekStart = computed(() => getMonday(selectedDate.value))

const weekDays = computed(() => {
  const days: {
    date: Date
    label: string
    dayName: string
    isToday: boolean
    fullLabel: string
    dots: string[]
  }[] = []

  for (let i = 0; i < 7; i++) {
    const d = addDays(selectedWeekStart.value, i)
    days.push({
      date: d,
      label: String(d.getDate()),
      dayName: dayNames[i] ?? "",
      isToday: isSameDate(d, now.value),
      fullLabel: d.toLocaleDateString("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
      }),
      dots: eventsForDate(d).slice(0, 3).map(eventChipColor),
    })
  }

  return days
})

const navLabel = computed(() => {
  if (monthExpanded.value) {
    return selectedDate.value.toLocaleDateString("en-US", { month: "long", year: "numeric" })
  }

  const start = selectedWeekStart.value
  const end = addDays(start, 6)
  const startLabel = start.toLocaleDateString("en-US", { month: "short", day: "numeric" })
  const endLabel = end.toLocaleDateString("en-US", { month: "short", day: "numeric" })
  if (start.getFullYear() !== end.getFullYear()) {
    const full = (d: Date) =>
      d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    return `${full(start)} – ${full(end)}`
  }
  return start.getMonth() === end.getMonth()
    ? `${startLabel} – ${end.getDate()}`
    : `${startLabel} – ${endLabel}`
})

const selectedDateLabel = computed(() => {
  const d = selectedDate.value
  const today = startOfDay(new Date())
  const tomorrow = addDays(today, 1)

  let lead = d.toLocaleDateString("en-US", { weekday: "long" })
  if (isSameDate(d, today)) lead = "Today"
  else if (isSameDate(d, tomorrow)) lead = "Tomorrow"

  const date = d.toLocaleDateString("en-US", { month: "short", day: "numeric" })
  return `${lead} · ${date}`
})

function shiftWeek(delta: number) {
  selectedDate.value = addDays(selectedDate.value, delta * 7)
}

function shiftMonth(delta: number) {
  selectedDate.value = addMonthsClamped(selectedDate.value, delta)
}

function navPrev() {
  if (monthExpanded.value) shiftMonth(-1)
  else shiftWeek(-1)
}

function navNext() {
  if (monthExpanded.value) shiftMonth(1)
  else shiftWeek(1)
}

function goToToday() {
  const n = new Date()
  now.value = n
  selectedDate.value = n
}

function selectDay(date: Date) {
  selectedDate.value = new Date(date)
}

function toggleMonth() {
  monthExpanded.value = !monthExpanded.value
}

const agendaEl = ref<HTMLElement | null>(null)
const GESTURE_THRESHOLD = 24
const WHEEL_THRESHOLD = 8
let touchStartY: number | null = null
let lastAgendaScrollTop = 0

function collapseMonth() {
  monthExpanded.value = false
}

function expandMonth() {
  monthExpanded.value = true
}

function onAgendaScroll() {
  const top = agendaEl.value?.scrollTop ?? 0
  if (monthExpanded.value) {
    if (top > GESTURE_THRESHOLD) collapseMonth()
  } else if (top === 0 && top < lastAgendaScrollTop) {
    expandMonth()
  }
  lastAgendaScrollTop = top
}

function onWheel(e: WheelEvent) {
  if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return
  if (e.deltaY > WHEEL_THRESHOLD) collapseMonth()
  else if (e.deltaY < -WHEEL_THRESHOLD) expandMonth()
}

function onTouchStart(e: TouchEvent) {
  if (e.touches.length !== 1) {
    touchStartY = null
    return
  }
  touchStartY = e.touches[0]!.clientY
}

function onTouchMove(e: TouchEvent) {
  if (touchStartY === null || e.touches.length !== 1) return
  const y = e.touches[0]!.clientY
  const delta = touchStartY - y
  if (delta > GESTURE_THRESHOLD) {
    if (monthExpanded.value) {
      collapseMonth()
      touchStartY = y
    }
  } else if (delta < -GESTURE_THRESHOLD) {
    if (!monthExpanded.value) {
      expandMonth()
      touchStartY = y
    }
  }
}

function onTouchEnd() {
  touchStartY = null
}

const prefetched = { year: -1, month: -1 }

function prefetchMonthOf(date: Date) {
  const year = date.getFullYear()
  const month = date.getMonth()
  if (prefetched.year === year && prefetched.month === month) return
  prefetched.year = year
  prefetched.month = month
  prefetchAround(year, month)
}

watch(selectedDate, date => prefetchMonthOf(date))

onMounted(async () => {
  await Promise.all([
    loadMembers(),
    prefetchAround(now.value.getFullYear(), now.value.getMonth()),
  ])
  prefetched.year = now.value.getFullYear()
  prefetched.month = now.value.getMonth()
  nowInterval = setInterval(() => {
    now.value = new Date()
  }, 60_000)
})

onUnmounted(() => {
  if (nowInterval !== null) clearInterval(nowInterval)
})

const dayEvents = computed(() => {
  return eventsForDate(selectedDate.value)
    .slice()
    .sort((a, b) => {
      if (a.allDay !== b.allDay) return a.allDay ? -1 : 1
      return new Date(a.startAt).getTime() - new Date(b.startAt).getTime()
    })
})

const eventCountLabel = computed(() => {
  const n = dayEvents.value.length
  return n === 1 ? "1 event" : `${n} events`
})
</script>

<template>
  <section
    class="mobile-calendar"
    :data-expanded="monthExpanded"
    aria-label="Calendar"
    @touchstart.passive="onTouchStart"
    @touchmove.passive="onTouchMove"
    @touchend="onTouchEnd"
    @touchcancel="onTouchEnd"
    @wheel.passive="onWheel"
  >
    <div class="mc-toolbar">
      <div class="mc-month-nav">
        <button
          class="mc-nav-btn"
          type="button"
          :aria-label="monthExpanded ? 'Previous month' : 'Previous week'"
          @click="navPrev"
        >
          <PhCaretLeft :size="18" />
        </button>
        <button
          class="mc-month-label"
          type="button"
          aria-controls="mc-calendar-body"
          :aria-expanded="monthExpanded"
          :aria-label="monthExpanded ? 'Collapse calendar to the selected week' : 'Expand calendar to the full month'"
          @click="toggleMonth"
        >
          <span>{{ navLabel }}</span>
          <PhCaretUp v-if="monthExpanded" :size="14" />
          <PhCaretDown v-else :size="14" />
        </button>
        <button
          class="mc-nav-btn"
          type="button"
          :aria-label="monthExpanded ? 'Next month' : 'Next week'"
          @click="navNext"
        >
          <PhCaretRight :size="18" />
        </button>
      </div>
      <button class="mc-today-chip" type="button" @click="goToToday">Today</button>
    </div>

    <div
      id="mc-calendar-body"
      class="mc-calendar-body"
      :class="{ 'is-collapsed': !monthExpanded }"
      :style="{ '--mc-month-rows': monthRowCount }"
    >
      <div
        class="mc-month-panel"
        :aria-hidden="monthExpanded ? undefined : 'true'"
        :inert="monthExpanded ? undefined : true"
      >
        <div class="mc-month-dow" aria-hidden="true">
          <span v-for="d in dayNames" :key="d">{{ d }}</span>
        </div>
        <div class="mc-month-grid" role="group" aria-label="Days of the month">
          <button
            v-for="cell in monthCells"
            :key="cell.key"
            class="mc-month-day"
            :class="{
              'not-month': !cell.inMonth,
              today: cell.isToday,
              active: cell.isSelected,
            }"
            type="button"
            :aria-label="monthCellLabel(cell)"
            :aria-pressed="cell.isSelected"
            :aria-current="cell.isToday ? 'date' : undefined"
            @click="selectDay(cell.date)"
          >
            <span class="mc-month-day-num">{{ cell.day }}</span>
            <span class="mc-month-dots" aria-hidden="true">
              <span
                v-for="(color, i) in cell.dots"
                :key="i"
                class="mc-month-dot"
                :style="{ background: color }"
              />
            </span>
          </button>
        </div>
      </div>

      <div
        class="mc-week-strip"
        role="group"
        aria-label="Days of the week"
        :aria-hidden="monthExpanded ? 'true' : undefined"
        :inert="monthExpanded ? true : undefined"
      >
        <button
          v-for="d in weekDays"
          :key="d.date.toISOString()"
          class="mc-day-btn"
          :class="{
            active: isSameDate(d.date, selectedDate),
            today: d.isToday,
          }"
          type="button"
          :aria-label="d.fullLabel"
          :aria-pressed="isSameDate(d.date, selectedDate)"
          @click="selectDay(d.date)"
        >
          <span class="mc-day-name">{{ d.dayName }}</span>
          <span class="mc-day-num">{{ d.label }}</span>
          <span class="mc-day-dots" aria-hidden="true">
            <span
              v-for="(color, i) in d.dots"
              :key="i"
              class="mc-day-dot"
              :style="{ background: color }"
            />
          </span>
        </button>
      </div>
    </div>

    <div ref="agendaEl" class="mc-agenda" @scroll.passive="onAgendaScroll">
      <div class="mc-agenda-head">
        <h2 class="mc-agenda-date">{{ selectedDateLabel }}</h2>
        <span class="mc-agenda-count">{{ eventCountLabel }}</span>
      </div>

      <div v-if="!initialized && dayEvents.length === 0" class="mc-state">
        <p class="mc-state-hint">Loading events…</p>
      </div>

      <div v-else-if="dayEvents.length === 0" class="mc-state">
        <span class="mc-state-icon">
          <PhCalendarBlank :size="24" />
        </span>
        <p class="mc-state-title">Nothing scheduled</p>
        <p class="mc-state-hint">Tap + to add an event</p>
      </div>

      <div v-else class="mc-events">
        <button
          v-for="ev in dayEvents"
          :key="ev.id"
          class="mc-event"
          :class="{ 'mc-event--allday': ev.allDay }"
          type="button"
          @click="emit('selectEvent', ev.id.split('::')[0])"
        >
          <span class="mc-event-time" :class="{ 'mc-event-time--allday': ev.allDay }">
            {{ ev.allDay ? "All day" : formatEventTime(ev.startAt) }}
          </span>
          <span class="mc-event-title">{{ ev.title }}</span>
          <span
            class="mc-event-dot"
            :style="{ background: eventChipColor(ev) }"
            :title="assigneeName(ev) ? `Assigned to ${assigneeName(ev)}` : 'Unassigned'"
          />
        </button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.mobile-calendar {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.mc-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  flex-shrink: 0;
  padding: var(--space-1) var(--space-4) 0;
}

.mc-month-nav {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  min-width: 0;
}

.mc-month-label {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 2px;
  min-width: 0;
  min-height: 44px;
  padding: 0 var(--space-1);
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-textPrimary);
  font-family: var(--font-family);
  font-size: var(--text-body-size);
  font-weight: var(--font-weight-medium);
  white-space: nowrap;
  cursor: pointer;
  transition: background var(--duration-fast) cubic-bezier(0.25, 0.46, 0.45, 0.94);
}

.mc-month-label span {
  overflow: hidden;
  text-overflow: ellipsis;
}

.mc-month-label:active {
  background: var(--color-bgSubtle);
  transform: scale(0.98);
}

.mc-nav-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  min-width: 48px;
  min-height: 48px;
  flex-shrink: 0;
  border: none;
  border-radius: var(--radius-full);
  background: transparent;
  color: var(--color-textSecondary);
  cursor: pointer;
}

.mc-nav-btn:active {
  background: var(--color-bgSubtle);
  transform: scale(0.94);
}

.mc-today-chip {
  min-width: 0;
  min-height: 48px;
  padding: 0 var(--space-4);
  flex-shrink: 0;
  border: none;
  border-radius: var(--radius-full);
  background: var(--color-accent-lighter);
  color: var(--color-accent-darker);
  font-family: var(--font-family);
  font-size: var(--text-label-size);
  font-weight: var(--font-weight-medium);
  cursor: pointer;
}

.mc-today-chip:active {
  transform: scale(0.96);
  background: var(--color-accent-light);
}

.mc-calendar-body {
  --mc-month-row-h: 44px;
  --mc-month-dow-h: 20px;
  --mc-week-row-h: 58px;
  display: grid;
  grid-template-areas: "calendar";
  grid-template-rows: 1fr;
  flex-shrink: 0;
  min-height: 0;
  height: calc(
    var(--mc-month-dow-h) +
    var(--mc-month-rows, 6) * var(--mc-month-row-h) +
    (var(--mc-month-rows, 6) - 1) * var(--space-1) +
    var(--space-2)
  );
  overflow: hidden;
  transition: height var(--duration-slow) cubic-bezier(0.22, 1, 0.36, 1);
}

.mc-calendar-body.is-collapsed {
  height: calc(var(--mc-week-row-h) + 2 * var(--space-2));
}

.mc-month-panel {
  grid-area: calendar;
  align-self: start;
  padding: 0 var(--space-4) var(--space-2);
  opacity: 1;
  transform: translateY(0) scale(1);
  transform-origin: top center;
  transition:
    opacity var(--duration-slow) cubic-bezier(0.2, 0.7, 0.3, 1),
    transform var(--duration-slow) cubic-bezier(0.22, 1, 0.36, 1),
    visibility 0s linear 0s;
}

.mc-calendar-body.is-collapsed .mc-month-panel {
  opacity: 0;
  transform: translateY(-10px) scale(0.985);
  visibility: hidden;
  pointer-events: none;
  transition:
    opacity var(--duration-slow) cubic-bezier(0.2, 0.7, 0.3, 1),
    transform var(--duration-slow) cubic-bezier(0.22, 1, 0.36, 1),
    visibility 0s linear var(--duration-slow);
}

.mc-month-dow {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: var(--space-1);
  align-items: center;
  height: var(--mc-month-dow-h);
  padding: 0;
}

.mc-month-dow span {
  overflow: hidden;
  text-align: center;
  font-size: var(--text-micro-size);
  font-weight: var(--font-weight-medium);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--color-textSecondary);
}

.mc-month-grid {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: var(--space-1);
}

.mc-month-day {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 3px;
  min-width: 0;
  min-height: 44px;
  padding: 2px 0;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-textPrimary);
  font-family: var(--font-family);
  cursor: pointer;
  transition:
    background var(--duration-fast) cubic-bezier(0.25, 0.46, 0.45, 0.94),
    color var(--duration-fast) cubic-bezier(0.25, 0.46, 0.45, 0.94),
    transform var(--duration-fast) cubic-bezier(0.25, 0.46, 0.45, 0.94);
}

.mc-month-day:active {
  transform: scale(0.94);
}

.mc-month-day.not-month {
  color: var(--color-textSecondary);
  opacity: 0.45;
}

.mc-month-day.today:not(.active) {
  background: var(--color-accent-lighter);
  color: var(--color-accent-darker);
}

.mc-month-day.active {
  background: var(--color-accent-darker);
  color: var(--color-textInverse);
  box-shadow:
    0 3px 10px -4px var(--shadow-accent-drop),
    inset 0 1px 2px var(--shadow-shine);
}

.mc-month-day-num {
  font-size: var(--text-label-size);
  font-weight: var(--font-weight-medium);
  line-height: 1.1;
  font-variant-numeric: tabular-nums;
}

.mc-month-dots {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 2px;
  height: 4px;
}

.mc-month-dot {
  width: 4px;
  height: 4px;
  flex-shrink: 0;
  border-radius: var(--radius-full);
}

.mc-month-day.active .mc-month-dot {
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--color-textInverse) 45%, transparent);
}

.mc-week-strip {
  display: flex;
  grid-area: calendar;
  align-self: start;
  gap: var(--space-1);
  flex-shrink: 0;
  padding: var(--space-2) var(--space-4);
  opacity: 0;
  visibility: hidden;
  transform: translateY(8px);
  pointer-events: none;
  transition:
    opacity var(--duration-slow) cubic-bezier(0.2, 0.7, 0.3, 1),
    transform var(--duration-slow) cubic-bezier(0.22, 1, 0.36, 1),
    visibility 0s linear var(--duration-slow);
}

.mc-calendar-body.is-collapsed .mc-week-strip {
  opacity: 1;
  visibility: visible;
  transform: translateY(0);
  pointer-events: auto;
  transition:
    opacity var(--duration-slow) cubic-bezier(0.2, 0.7, 0.3, 1),
    transform var(--duration-slow) cubic-bezier(0.22, 1, 0.36, 1),
    visibility 0s linear 0s;
}

.mc-day-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1px;
  flex: 1;
  min-width: 0;
  min-height: 58px;
  padding: var(--space-1) 0;
  border: none;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--color-textSecondary);
  font-family: var(--font-family);
  cursor: pointer;
  transition:
    background var(--duration-fast) cubic-bezier(0.25, 0.46, 0.45, 0.94),
    color var(--duration-fast) cubic-bezier(0.25, 0.46, 0.45, 0.94);
}

.mc-day-btn:hover {
  background: var(--color-bgSubtle);
}

.mc-day-btn.today:not(.active) {
  background: var(--color-accent-lighter);
  color: var(--color-accent-darker);
}

.mc-day-btn.active {
  background: var(--color-accent-darker);
  color: var(--color-textInverse);
  box-shadow:
    0 3px 10px -4px var(--shadow-accent-drop),
    inset 0 1px 2px var(--shadow-shine);
}

.mc-day-name {
  font-size: var(--text-micro-size);
  font-weight: var(--font-weight-medium);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  line-height: 1.2;
}

.mc-day-num {
  font-size: var(--text-heading-size);
  font-weight: var(--font-weight-medium);
  line-height: 1.2;
  font-variant-numeric: tabular-nums;
}

.mc-day-dots {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 2px;
  height: 4px;
}

.mc-day-dot {
  width: 4px;
  height: 4px;
  flex-shrink: 0;
  border-radius: var(--radius-full);
}

.mc-day-btn.active .mc-day-dot {
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--color-textInverse) 45%, transparent);
}

.mc-agenda {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 0 var(--space-4) var(--space-4);
  overscroll-behavior: contain;
}

.mc-agenda-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-3);
  padding: var(--space-2) 0 var(--space-3);
}

.mc-agenda-date {
  font-size: var(--text-heading-size);
  font-weight: var(--font-weight-medium);
  color: var(--color-textPrimary);
}

.mc-agenda-count {
  flex-shrink: 0;
  font-size: var(--text-label-size);
  color: var(--color-textSecondary);
}

.mc-events {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.mc-event {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: var(--space-3);
  width: 100%;
  min-height: 56px;
  padding: var(--space-3) var(--space-4);
  border: none;
  border-radius: var(--radius-md);
  background: var(--color-bgElevated);
  color: var(--color-textPrimary);
  font-family: var(--font-family);
  font-size: var(--text-body-size);
  text-align: left;
  cursor: pointer;
  box-shadow:
    0 2px 0 0 var(--color-bgSubtle),
    0 6px 16px -8px var(--shadow-accent-drop),
    inset 0 1px 2px var(--shadow-shine);
  transition: transform var(--duration-fast) cubic-bezier(0.25, 0.46, 0.45, 0.94);
}

.mc-event--allday {
  background: color-mix(in srgb, var(--color-accent-lighter) 55%, var(--color-bgElevated));
}

.mc-event:active {
  transform: translateY(1px) scale(0.995);
  box-shadow: inset 0 2px 6px var(--shadow-accent-drop);
}

.mc-event-time {
  font-size: var(--text-label-size);
  color: var(--color-textSecondary);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.mc-event-time--allday {
  color: var(--color-accent-darker);
  font-weight: var(--font-weight-medium);
}

.mc-event-title {
  font-size: var(--text-body-size);
  font-weight: var(--font-weight-regular);
  color: var(--color-textPrimary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mc-event-dot {
  width: 10px;
  height: 10px;
  border-radius: var(--radius-full);
  flex-shrink: 0;
}

.mc-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  flex: 1;
  padding: var(--space-8) var(--space-6);
  text-align: center;
}

.mc-state-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 56px;
  height: 56px;
  margin-bottom: var(--space-1);
  border-radius: var(--radius-full);
  background: var(--color-bgSubtle);
  color: var(--color-accent-darker);
}

.mc-state-title {
  font-size: var(--text-heading-size);
  font-weight: var(--font-weight-medium);
  color: var(--color-textPrimary);
}

.mc-state-hint {
  font-size: var(--text-label-size);
  line-height: 1.5;
  color: var(--color-textSecondary);
}

.mc-nav-btn:focus-visible,
.mc-month-label:focus-visible,
.mc-today-chip:focus-visible,
.mc-month-day:focus-visible,
.mc-day-btn:focus-visible,
.mc-event:focus-visible {
  outline: 2px solid var(--color-accent-darker);
  outline-offset: 2px;
}
</style>
