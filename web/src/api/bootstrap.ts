import { api } from "./client"
import { mapAnnouncement, type ApiAnnouncement } from "./announcements"
import { mapCalendar, mapEvent, type ApiCalendar, type ApiEvent } from "./calendar"
import type { Holiday } from "./holidays"
import type { HouseholdSettings } from "./household"
import type { PhotoEntry } from "./photos"
import { mapTask, mapTaskList, type ApiTask, type ApiTaskList } from "./tasks"
import { mapMember, type ApiMember } from "./users"
import type { Announcement } from "@/composables/useAnnouncements"
import type { Calendar, Event } from "@/composables/useEvents"
import type { Member } from "@/composables/useMembers"
import type { Task, TaskList } from "@/composables/useTasks"

interface ApiBootstrap {
  settings: HouseholdSettings
  members?: ApiMember[]
  photos?: PhotoEntry[]
  calendars?: ApiCalendar[]
  events?: ApiEvent[]
  task_lists?: ApiTaskList[]
  tasks?: ApiTask[]
  holidays?: Holiday[]
  announcements?: ApiAnnouncement[]
}

export interface BootstrapPayload {
  settings: HouseholdSettings
  members: Member[]
  photos: PhotoEntry[]
  calendars: Calendar[]
  events: Event[]
  taskLists: TaskList[]
  tasks: Task[]
  holidays: Holiday[]
  announcements: Announcement[]
}

export const bootstrapApi = {
  async load(from: string, to: string): Promise<BootstrapPayload> {
    const params = new URLSearchParams({ from, to })
    const raw = await api.get<ApiBootstrap>(`/bootstrap?${params}`)
    if (!raw || Array.isArray(raw) || typeof raw.settings !== "object" || raw.settings === null) {
      throw new Error("Invalid bootstrap payload")
    }
    return {
      settings: raw.settings,
      members: (raw.members ?? []).map(mapMember),
      photos: raw.photos ?? [],
      calendars: (raw.calendars ?? []).map(mapCalendar),
      events: (raw.events ?? []).map(mapEvent),
      taskLists: (raw.task_lists ?? []).map(mapTaskList),
      tasks: (raw.tasks ?? []).map(mapTask),
      holidays: raw.holidays ?? [],
      announcements: (raw.announcements ?? []).map(mapAnnouncement),
    }
  },
}
