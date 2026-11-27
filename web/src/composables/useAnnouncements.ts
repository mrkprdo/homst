import { ref } from "vue"
import { announcementsApi } from "@/api/announcements"

export interface Announcement {
  id: string
  householdId: string
  message: string
  createdBy: string | null
  authorName: string | null
  createdAt: string
  expiresAt: string | null
}

export interface SendAnnouncementInput {
  message: string
  createdBy?: string | null
  durationMinutes?: number | null
  sendPush?: boolean
}

const DISMISSED_KEY = "homst-dismissed-announcements"
const MAX_STORED_DISMISSALS = 100

const announcements = ref<Announcement[]>([])
const dismissed = ref<Set<string>>(readDismissed())
const loading = ref(false)
const initialized = ref(false)
const error = ref("")

let inFlight: Promise<void> | null = null

function readDismissed(): Set<string> {
  try {
    const raw = localStorage.getItem(DISMISSED_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return new Set(Array.isArray(parsed) ? parsed.filter(x => typeof x === "string") : [])
  } catch {
    return new Set()
  }
}

function persistDismissed() {
  try {
    const ids = Array.from(dismissed.value).slice(-MAX_STORED_DISMISSALS)
    localStorage.setItem(DISMISSED_KEY, JSON.stringify(ids))
  } catch {
  }
}

function sorted(items: Announcement[]): Announcement[] {
  return [...items].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

function upsertAnnouncement(announcement: Announcement) {
  const idx = announcements.value.findIndex(a => a.id === announcement.id)
  if (idx >= 0) {
    const next = [...announcements.value]
    next[idx] = announcement
    announcements.value = sorted(next)
  } else {
    announcements.value = sorted([...announcements.value, announcement])
  }
}

function removeAnnouncement(id: string) {
  announcements.value = announcements.value.filter(a => a.id !== id)
}

export function isAnnouncementActive(a: Announcement, now = Date.now()): boolean {
  if (!a.expiresAt) return true
  const expiresAt = new Date(a.expiresAt).getTime()
  return Number.isNaN(expiresAt) || expiresAt > now
}

function visible(now = Date.now()): Announcement[] {
  return announcements.value.filter(
    a => isAnnouncementActive(a, now) && !dismissed.value.has(a.id),
  )
}

function dismiss(id: string) {
  const next = new Set(dismissed.value)
  next.add(id)
  dismissed.value = next
  persistDismissed()
}

async function ensureLoaded() {
  if (initialized.value) return
  if (inFlight) return inFlight

  loading.value = true
  inFlight = announcementsApi
    .list()
    .then(items => {
      announcements.value = sorted(items)
      error.value = ""
    })
    .catch(() => {
      error.value = "Could not load announcements"
    })
    .finally(() => {
      loading.value = false
      initialized.value = true
      inFlight = null
    })

  return inFlight
}

async function refresh() {
  initialized.value = false
  await ensureLoaded()
}

function hydrate(items: Announcement[]) {
  announcements.value = sorted(items)
  loading.value = false
  initialized.value = true
  error.value = ""
}

async function send(input: SendAnnouncementInput) {
  const created = await announcementsApi.create({
    message: input.message,
    created_by: input.createdBy ?? null,
    duration_minutes: input.durationMinutes ?? null,
    send_push: input.sendPush ?? true,
  })
  upsertAnnouncement(created)
  return created
}

async function remove(id: string) {
  await announcementsApi.remove(id)
  removeAnnouncement(id)
}

export function useAnnouncements() {
  return {
    announcements,
    dismissed,
    loading,
    error,
    visible,
    ensureLoaded,
    refresh,
    send,
    remove,
    dismiss,
    upsertAnnouncement,
    removeAnnouncement,
    hydrate,
  }
}

export function _resetAnnouncements() {
  announcements.value = []
  dismissed.value = new Set()
  loading.value = false
  initialized.value = false
  error.value = ""
  inFlight = null
  try {
    localStorage.removeItem(DISMISSED_KEY)
  } catch {}
}
