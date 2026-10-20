import { ref } from "vue"
import { calendarApi } from "@/api/calendar"
import { holidaysApi } from "@/api/holidays"

export interface Event {
  id: string
  calendarId: string
  title: string
  description: string
  startAt: string
  endAt: string | null
  allDay: boolean
  recurrence: object | null
  reminderMinutes?: number | null
  source: "internal" | "external"
  externalUid: string | null
  createdBy: string | null
  createdAt: string
  updatedAt: string
  assigneeId?: string
}

export interface Calendar {
  id: string
  householdId: string
  name: string
  color: string
  source: string
  feedUrl: string | null
  isVisible: boolean
  createdBy: string | null
}

const HOLIDAYS_CAL_ID = "00000000-0000-0000-0000-000000000001"

const events    = ref<Event[]>([])
const calendars = ref<Calendar[]>([])
const loading   = ref(false)
const initialized = ref(false)

const fetchedMonths    = new Set<string>()
const holidaysFetched  = ref(false)
const calendarsFetched = ref(false)

function monthKey(year: number, month: number): string {
  return `${year}-${month}`
}

function upsertEvent(ev: Event) {
  const idx = events.value.findIndex(e => e.id === ev.id)
  if (idx >= 0) events.value[idx] = ev
  else events.value.push(ev)
}

function removeEvent(id: string) {
  events.value = events.value.filter(e => e.id !== id)
}

function upsertCalendar(cal: Calendar) {
  const idx = calendars.value.findIndex(c => c.id === cal.id)
  if (idx >= 0) calendars.value[idx] = cal
  else calendars.value.push(cal)
}

function removeCalendar(id: string) {
  calendars.value = calendars.value.filter(c => c.id !== id)
  events.value = events.value.filter(e => e.calendarId !== id)
}

async function ensureCalendars() {
  if (calendarsFetched.value) return
  calendarsFetched.value = true
  const cals = await calendarApi.getCalendars().catch(() => [])
  for (const c of cals) upsertCalendar(c)
}

async function ensureDefaultCalendar(): Promise<string> {
  await ensureCalendars()
  // Skip local-only sentinel calendars (holidays) that have no DB backing
  const real = calendars.value.find(c => c.id !== HOLIDAYS_CAL_ID)
  if (real) return real.id
  const cal = await calendarApi.createCalendar({ name: "Personal", color: "sage", source: "internal" }).catch(() => null)
  if (cal) {
    upsertCalendar(cal)
    return cal.id
  }
  return "default"
}

async function ensureHolidays() {
  if (holidaysFetched.value) return
  holidaysFetched.value = true
  const hols = await holidaysApi.list().catch(() => [])
  if (hols.length === 0) return
  upsertCalendar({
    id: HOLIDAYS_CAL_ID, householdId: "default", name: "Holidays",
    color: "sky", source: "internal", feedUrl: null, isVisible: true, createdBy: null,
  })
  for (const h of hols) {
    const startAt = new Date(h.date + "T00:00:00").toISOString()
    upsertEvent({
      id: h.id, calendarId: HOLIDAYS_CAL_ID, title: h.name, description: "",
      startAt, endAt: startAt, allDay: true, recurrence: null,
      source: "external", externalUid: null, createdBy: null,
      createdAt: h.created_at, updatedAt: h.created_at,
    })
  }
}

async function ensureMonth(year: number, month: number) {
  const key = monthKey(year, month)
  if (fetchedMonths.has(key)) return
  fetchedMonths.add(key)
  const from = new Date(year, month, 1).toISOString()
  const to   = new Date(year, month + 1, 0, 23, 59, 59).toISOString()
  const evs = await calendarApi.getEvents({ from, to }).catch(() => [])
  for (const ev of evs) upsertEvent(ev)
}

function adjMonth(year: number, month: number, delta: -1 | 1) {
  if (delta === -1) return month === 0  ? { year: year - 1, month: 11 } : { year, month: month - 1 }
  return month === 11 ? { year: year + 1, month: 0  } : { year, month: month + 1 }
}

async function prefetchAround(year: number, month: number) {
  loading.value = true
  const prev = adjMonth(year, month, -1)
  const next = adjMonth(year, month,  1)
  await Promise.all([
    ensureCalendars(),
    ensureHolidays(),
    ensureMonth(year, month),
    ensureMonth(prev.year, prev.month),
    ensureMonth(next.year, next.month),
  ])
  loading.value = false
  initialized.value = true
}

async function refresh() {
  fetchedMonths.clear()
  holidaysFetched.value  = false
  calendarsFetched.value = false
  const n = new Date()
  await prefetchAround(n.getFullYear(), n.getMonth())
}

export function useEvents() {
  return {
    events, calendars, loading, initialized,
    upsertEvent, removeEvent,
    upsertCalendar, removeCalendar,
    ensureCalendars, ensureHolidays,
    ensureMonth, ensureDefaultCalendar,
    prefetchAround, refresh,
  }
}

export function _resetEvents() {
  events.value = []
  calendars.value = []
  loading.value = false
  initialized.value = false
  fetchedMonths.clear()
  holidaysFetched.value = false
  calendarsFetched.value = false
}
