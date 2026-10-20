<script setup lang="ts">
import { ref, computed, onMounted } from "vue"
import { useEvents, type Event } from "@/composables/useEvents"
import { useMembers } from "@/composables/useMembers"
import { memberColorHex, type MemberColor } from "@/types/household"
import { PhCalendarBlank, PhCaretLeft, PhCaretRight } from "@phosphor-icons/vue"

const emit = defineEmits<{ selectEvent: [id: string] }>()

const { events, initialized, prefetchAround } = useEvents()
const { members, ensureLoaded: loadMembers } = useMembers()

const now = ref(new Date())
const selectedDate = ref(new Date())
const weekStart = ref(getMonday(selectedDate.value))

function getMonday(d: Date) {
  const date = new Date(d)
  const day = date.getDay()
  const diff = date.getDate() - day + (day === 0 ? -6 : 1)
  date.setDate(diff)
  date.setHours(0, 0, 0, 0)
  return date
}

function isSameDate(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

onMounted(async () => {
  await Promise.all([
    loadMembers(),
    prefetchAround(now.value.getFullYear(), now.value.getMonth()),
  ])
  weekStart.value = getMonday(selectedDate.value)
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

const weekDays = computed(() => {
  const days: { date: Date; label: string; dayName: string; isToday: boolean; fullLabel: string }[] = []
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStart.value)
    d.setDate(d.getDate() + i)
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
    })
  }
  return days
})

function monthLabel() {
  return selectedDate.value.toLocaleDateString("en-US", { month: "long", year: "numeric" })
}

const selectedDateLabel = computed(() => {
  const d = selectedDate.value
  const today = new Date()
  const tomorrow = new Date(today)
  tomorrow.setDate(tomorrow.getDate() + 1)

  let lead = d.toLocaleDateString("en-US", { weekday: "long" })
  if (isSameDate(d, today)) lead = "Today"
  else if (isSameDate(d, tomorrow)) lead = "Tomorrow"

  const date = d.toLocaleDateString("en-US", { month: "short", day: "numeric" })
  return `${lead} · ${date}`
})

function shiftWeek(delta: number) {
  const nextWeek = new Date(weekStart.value)
  nextWeek.setDate(nextWeek.getDate() + delta * 7)
  weekStart.value = nextWeek

  const nextSelected = new Date(selectedDate.value)
  nextSelected.setDate(nextSelected.getDate() + delta * 7)
  selectedDate.value = nextSelected

  prefetchAround(nextWeek.getFullYear(), nextWeek.getMonth())
}

function goToToday() {
  const n = new Date()
  now.value = n
  selectedDate.value = n
  weekStart.value = getMonday(n)
  prefetchAround(n.getFullYear(), n.getMonth())
}

function selectDay(date: Date) {
  selectedDate.value = date
}

function eventCoversDate(ev: Event, date: Date): boolean {
  const start = new Date(ev.startAt)
  const dayStart = new Date(date)
  dayStart.setHours(0, 0, 0, 0)
  const dayEnd = new Date(dayStart)
  dayEnd.setDate(dayEnd.getDate() + 1)
  if (start >= dayEnd) return false
  let end = ev.endAt ? new Date(ev.endAt) : start
  // Legacy all-day events store end_at === start_at; treat them as covering exactly their start day
  if (ev.allDay && end.getTime() <= start.getTime()) end = new Date(start.getTime() + 1)
  return end >= dayStart
}

const dayEvents = computed(() => {
  return events.value
    .filter(e => eventCoversDate(e, selectedDate.value))
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
  <section class="mobile-calendar" aria-label="Calendar">
    <div class="mc-toolbar">
      <div class="mc-month-nav">
        <button
          class="mc-nav-btn"
          type="button"
          aria-label="Previous week"
          @click="shiftWeek(-1)"
        >
          <PhCaretLeft :size="18" />
        </button>
        <span class="mc-month-label">{{ monthLabel() }}</span>
        <button
          class="mc-nav-btn"
          type="button"
          aria-label="Next week"
          @click="shiftWeek(1)"
        >
          <PhCaretRight :size="18" />
        </button>
      </div>
      <button class="mc-today-chip" type="button" @click="goToToday">Today</button>
    </div>

    <div class="mc-week-strip" role="group" aria-label="Days of the week">
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
        <span class="mc-day-marker" aria-hidden="true" />
      </button>
    </div>

    <div class="mc-agenda">
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
          @click="emit('selectEvent', ev.id)"
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

/* ── Month + Today ── */
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
  font-size: var(--text-body-size);
  font-weight: var(--font-weight-medium);
  color: var(--color-textPrimary);
  white-space: nowrap;
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

/* ── Week strip ── */
.mc-week-strip {
  display: flex;
  gap: var(--space-1);
  flex-shrink: 0;
  padding: var(--space-2) var(--space-4);
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

.mc-day-marker {
  width: 4px;
  height: 4px;
  border-radius: var(--radius-full);
  background: currentColor;
  opacity: 0;
}

.mc-day-btn.today:not(.active) .mc-day-marker {
  opacity: 1;
}

/* ── Day agenda ── */
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

/* ── Empty / loading ── */
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

/* ── Focus ── */
.mc-nav-btn:focus-visible,
.mc-today-chip:focus-visible,
.mc-day-btn:focus-visible,
.mc-event:focus-visible {
  outline: 2px solid var(--color-accent-darker);
  outline-offset: 2px;
}
</style>
