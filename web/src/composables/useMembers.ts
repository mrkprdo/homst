import { ref } from "vue"
import { usersApi } from "@/api/users"
import { memberColorHex, memberDefaultColor } from "@/types/household"

export interface Member {
  id: string
  householdId: string
  name: string
  avatarUrl: string | null
  color: string
  role: "member" | "admin"
  joinedAt: string
}

const members     = ref<Member[]>([])
const loading     = ref(false)
const initialized = ref(false)

function ensureColor(member: Member, index: number): string {
  return member.color || memberColorHex(memberDefaultColor(index))
}

function upsertMember(member: Member) {
  const idx = members.value.findIndex(m => m.id === member.id)
  if (idx >= 0) {
    members.value[idx] = { ...member, color: member.color || members.value[idx].color }
  } else {
    members.value.push({ ...member, color: ensureColor(member, members.value.length) })
  }
}

function removeMember(id: string) {
  members.value = members.value.filter(m => m.id !== id)
}

async function ensureLoaded() {
  if (initialized.value) return
  initialized.value = true
  loading.value = true
  const fetched = await usersApi.getMembers().catch(() => [])
  for (const m of fetched) upsertMember(m)
  loading.value = false
}

async function refresh() {
  initialized.value = false
  await ensureLoaded()
}

export function useMembers() {
  return { members, loading, upsertMember, removeMember, ensureLoaded, refresh }
}

export function _resetMembers() {
  members.value = []
  loading.value = false
  initialized.value = false
}