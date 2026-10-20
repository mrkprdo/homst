import { api } from "./client"
import type { Announcement } from "@/composables/useAnnouncements"

interface ApiAnnouncement {
  id: string
  household_id: string
  message: string
  created_by: string | null
  author_name: string | null
  created_at: string
  expires_at: string | null
}

export interface AnnouncementPayload {
  message: string
  created_by?: string | null
  duration_minutes?: number | null
  send_push?: boolean
}

export function mapAnnouncement(a: ApiAnnouncement): Announcement {
  return {
    id: a.id,
    householdId: a.household_id,
    message: a.message,
    createdBy: a.created_by,
    authorName: a.author_name,
    createdAt: a.created_at,
    expiresAt: a.expires_at,
  }
}

export const announcementsApi = {
  list: () =>
    api
      .get<ApiAnnouncement[]>("/announcements")
      .then(r => (Array.isArray(r) ? r : []).map(mapAnnouncement)),
  create: (data: AnnouncementPayload) =>
    api.post<ApiAnnouncement>("/announcements", data).then(mapAnnouncement),
  remove: (id: string) =>
    api.delete<{ message: string }>(`/announcements/${id}`),
}
