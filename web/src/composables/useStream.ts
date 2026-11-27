import { ref, onMounted, onUnmounted } from "vue"
import { useEvents } from "@/composables/useEvents"
import { useTasks } from "@/composables/useTasks"
import { useMembers } from "@/composables/useMembers"
import { useAnnouncements } from "@/composables/useAnnouncements"
import { useNotifications } from "@/composables/useNotifications"
import { useSettings, applyHouseholdSettings, refreshPhotos } from "@/composables/useSettings"
import { HOME_LAYOUT_EVENT } from "@/lib/homeLayout"
import {
  offerUpdatePrompt,
  refreshUpdatePrompt,
  setUpdateAutoInstall,
  updatePromptDismissed,
  updatePromptStarting,
} from "@/composables/useUpdatePrompt"
import { mapEvent } from "@/api/calendar"
import { mapTask } from "@/api/tasks"
import { mapMember } from "@/api/users"
import { mapAnnouncement } from "@/api/announcements"

export type ConnectionStatus = "connecting" | "connected" | "disconnected"

const isDisplayClient = typeof navigator === "undefined"
  || !/Mobi|Android|iPhone|iPad/i.test(navigator.userAgent)

const connected        = ref(false)
const status           = ref<ConnectionStatus>("disconnected")
const reconnectAttempt = ref(0)

let eventSource:    EventSource | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
const maxBackoff = 30000

let opens = 0
let syncFrames = 0

async function refreshAllStores() {
  const { refresh: refreshEvents } = useEvents()
  const { refresh: refreshTasks } = useTasks()
  const { refresh: refreshMembers } = useMembers()
  const { refresh: refreshAnnouncements } = useAnnouncements()
  const { refreshFromServer: refreshSettings } = useSettings()
  await Promise.allSettled([
    refreshEvents(),
    refreshTasks(),
    refreshMembers(),
    refreshAnnouncements(),
    refreshSettings(),
    isDisplayClient ? refreshUpdatePrompt() : Promise.resolve(),
  ])
}

let refreshInFlight: Promise<void> | null = null
function requestRefresh() {
  if (!refreshInFlight) {
    refreshInFlight = refreshAllStores().finally(() => { refreshInFlight = null })
  }
  return refreshInFlight
}

function notifyUpdateChanged() {
  window.dispatchEvent(new CustomEvent("homst:update-changed"))
}

function connect() {
  disconnect()
  status.value = "connecting"
  const source = new EventSource("/api/stream")
  eventSource = source

  const { upsertEvent, removeEvent } = useEvents()
  const { upsertTask,  removeTask  } = useTasks()
  const { upsertMember, removeMember } = useMembers()
  const { upsertAnnouncement, removeAnnouncement } = useAnnouncements()
  const { push: pushNotification } = useNotifications()

  source.onopen = () => {
    if (eventSource !== source) return
    opens++
    connected.value = true
    status.value = "connected"
    reconnectAttempt.value = 0
  }

  source.addEventListener("sync.required", () => {
    syncFrames++
    if (opens > 1 || syncFrames > 1) {
      notifyUpdateChanged()
      requestRefresh()
    }
  })

  source.addEventListener("event.created", (e) => {
    try { upsertEvent(mapEvent(JSON.parse(e.data))) } catch {}
  })
  source.addEventListener("event.updated", (e) => {
    try { upsertEvent(mapEvent(JSON.parse(e.data))) } catch {}
  })
  source.addEventListener("event.deleted", (e) => {
    try { const { id } = JSON.parse(e.data); removeEvent(id) } catch {}
  })
  source.addEventListener("task.created", (e) => {
    try { upsertTask(mapTask(JSON.parse(e.data))) } catch {}
  })
  source.addEventListener("task.updated", (e) => {
    try { upsertTask(mapTask(JSON.parse(e.data))) } catch {}
  })
  source.addEventListener("task.deleted", (e) => {
    try { const { id } = JSON.parse(e.data); removeTask(id) } catch {}
  })
  source.addEventListener("member.joined", (e) => {
    try { upsertMember(mapMember(JSON.parse(e.data))) } catch {}
  })
  source.addEventListener("member.updated", (e) => {
    try { upsertMember(mapMember(JSON.parse(e.data))) } catch {}
  })
  source.addEventListener("member.removed", (e) => {
    try { const { id } = JSON.parse(e.data); removeMember(id) } catch {}
  })
  source.addEventListener("settings.updated", (e) => {
    try {
      const data = JSON.parse(e.data)
      const settings = data.settings
      if (!settings || typeof settings !== "object") return
      applyHouseholdSettings(settings)
      if (settings.widgetLayout) {
        window.dispatchEvent(new CustomEvent(HOME_LAYOUT_EVENT, { detail: settings.widgetLayout }))
      }
      if (settings.updates) {
        notifyUpdateChanged()
        const autoInstall = settings.updates.autoInstall
        if (typeof autoInstall === "boolean") setUpdateAutoInstall(autoInstall)
      }
    } catch {}
  })
  source.addEventListener("announcement.created", (e) => {
    try { upsertAnnouncement(mapAnnouncement(JSON.parse(e.data))) } catch {}
  })
  source.addEventListener("announcement.deleted", (e) => {
    try { const { id } = JSON.parse(e.data); removeAnnouncement(id) } catch {}
  })
  source.addEventListener("photos.updated", () => {
    void refreshPhotos()
  })
  source.addEventListener("reminder.due", (e) => {
    try { pushNotification(JSON.parse(e.data)) } catch {}
  })
  source.addEventListener("system.update.available", (e) => {
    if (isDisplayClient) {
      try { offerUpdatePrompt(JSON.parse(e.data)) } catch {}
    }
    notifyUpdateChanged()
  })
  source.addEventListener("system.update.dismissed", (e) => {
    if (isDisplayClient) {
      try { updatePromptDismissed(JSON.parse(e.data).version) } catch {}
    }
    notifyUpdateChanged()
  })
  source.addEventListener("system.update.starting", (e) => {
    if (isDisplayClient) {
      try { updatePromptStarting(JSON.parse(e.data).version) } catch {}
    }
    notifyUpdateChanged()
  })

  source.onerror = () => {
    if (eventSource !== source) return
    connected.value = false
    status.value = "disconnected"
    source.close()
    eventSource = null
    scheduleReconnect()
  }
}

function scheduleReconnect() {
  if (reconnectTimer) clearTimeout(reconnectTimer)
  const delay = Math.min(1000 * 2 ** reconnectAttempt.value, maxBackoff)
  reconnectAttempt.value++
  reconnectTimer = setTimeout(() => connect(), delay)
}

function disconnect() {
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null }
  eventSource?.close()
  eventSource = null
  connected.value = false
  status.value = "disconnected"
}

export function useStream() {
  onMounted(() => connect())
  onUnmounted(() => disconnect())
  return { connected, status, reconnectAttempt, connect, disconnect }
}

export function _resetStream() {
  connected.value = false
  status.value = "disconnected"
  reconnectAttempt.value = 0
  opens = 0
  syncFrames = 0
  refreshInFlight = null
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null }
  eventSource?.close()
  eventSource = null
}
