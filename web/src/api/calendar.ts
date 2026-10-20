import { api } from "./client"
import type { Calendar, Event } from "@/composables/useEvents"

export interface CreateEventPayload {
  calendar_id: string
  title: string
  description?: string
  start_at: string
  end_at?: string
  all_day?: boolean
  recurrence?: object | null
  reminder_minutes?: number | null
  assignee_id?: string | null
}

export interface UpdateEventPayload {
  title?: string
  description?: string
  start_at?: string
  /** Explicit null clears the end (used to shrink multi-day all-day events back to single-day) */
  end_at?: string | null
  all_day?: boolean
  recurrence?: object | null
  /** Explicit null clears the reminder */
  reminder_minutes?: number | null
  assignee_id?: string | null
}

interface ApiCalendar {
  id: string; household_id: string; name: string; color: string
  source: string; feed_url: string | null; is_visible: boolean; created_by: string | null
}

interface ApiEvent {
  id: string; calendar_id: string; title: string; description: string
  start_at: string; end_at: string | null; all_day: boolean; recurrence: object | null
  reminder_minutes?: number | null
  source: string; external_uid: string | null; created_by: string | null
  created_at: string; updated_at: string; assignee_id?: string | null
}

function mapCalendar(c: ApiCalendar): Calendar {
  return { ...c, householdId: c.household_id, feedUrl: c.feed_url, isVisible: c.is_visible, createdBy: c.created_by }
}

export function mapEvent(e: ApiEvent): Event {
  return {
    id: e.id, calendarId: e.calendar_id, title: e.title, description: e.description,
    startAt: e.start_at, endAt: e.end_at ?? e.start_at, allDay: e.all_day,
    recurrence: e.recurrence, source: e.source as Event["source"],
    externalUid: e.external_uid, createdBy: e.created_by ?? "",
    createdAt: e.created_at, updatedAt: e.updated_at,
    assigneeId: e.assignee_id ?? undefined,
    reminderMinutes: e.reminder_minutes ?? null,
  }
}

export const calendarApi = {
  getCalendars: () => api.get<ApiCalendar[]>("/calendars").then(cals => (Array.isArray(cals) ? cals : []).map(mapCalendar)),
  createCalendar: (data: Partial<Calendar>) => api.post<ApiCalendar>("/calendars", data).then(c => mapCalendar(c as ApiCalendar)),
  subscribeCalendar: (feedUrl: string) => api.post<ApiCalendar>("/calendars/subscribe", { feed_url: feedUrl }).then(mapCalendar),
  updateCalendar: (id: string, data: Partial<Calendar>) => api.patch<ApiCalendar>(`/calendars/${id}`, data).then(mapCalendar),
  deleteCalendar: (id: string) => api.delete(`/calendars/${id}`),

  getEvents: (params: { from?: string; to?: string; calendar_ids?: string[] }) => {
    const searchParams = new URLSearchParams()
    if (params.from) searchParams.set("from", params.from)
    if (params.to) searchParams.set("to", params.to)
    if (params.calendar_ids?.length) searchParams.set("calendar_ids", params.calendar_ids.join(","))
    return api.get<ApiEvent[]>(`/events?${searchParams}`).then(events => (Array.isArray(events) ? events : []).map(mapEvent))
  },
  createEvent: (data: CreateEventPayload) => api.post<ApiEvent>("/events", data).then(e => mapEvent(e as ApiEvent)),
  updateEvent: (id: string, data: UpdateEventPayload) => api.patch<ApiEvent>(`/events/${id}`, data).then(e => mapEvent(e as ApiEvent)),
  deleteEvent: (id: string) => api.delete(`/events/${id}`),
}
