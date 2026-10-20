import { api } from "./client"
import type { Member } from "@/composables/useMembers"

interface ApiMember {
  id: string
  household_id: string
  name: string
  avatar_url: string | null
  color: string | null
  role: string
  joined_at: string
}

export interface MemberContactPayload {
  name?: string
  avatar_url?: string
  color?: string
  role?: string
}

export function mapMember(m: ApiMember): Member {
  return {
    id: m.id,
    householdId: m.household_id,
    name: m.name,
    avatarUrl: m.avatar_url,
    color: m.color ?? "",
    role: m.role as Member["role"],
    joinedAt: m.joined_at,
  }
}

export const usersApi = {
  getMembers: () =>
    api.get<ApiMember[]>("/household/members").then(r => (Array.isArray(r) ? r : []).map(mapMember)),
  createMember: (data: MemberContactPayload) =>
    api.post<ApiMember>("/household/members", data).then(mapMember),
  updateMember: (id: string, data: MemberContactPayload) =>
    api.patch<ApiMember>(`/household/members/${id}`, data).then(mapMember),
  removeMember: (id: string) => api.delete(`/household/members/${id}`),
}
