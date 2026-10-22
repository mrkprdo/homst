import { ref, onMounted, onUnmounted } from "vue"
import { useEvents } from "@/composables/useEvents"
import { useTasks } from "@/composables/useTasks"
import { useMembers } from "@/composables/useMembers"
import { useAnnouncements } from "@/composables/useAnnouncements"
import { useNotifications } from "@/composables/useNotifications"
import { useSettings, applyHouseholdSettings, refreshPhotos } from "@/composables/useSettings"
import {
  offerUpdatePrompt,
  refreshUpdatePrompt,
  updatePromptDismissed,
  updatePromptStarting,
} from "@/composables/useUpdatePrompt"
import { mapEvent } from "@/api/calendar"
import { mapTask } from "@/api/tasks"
import { mapMember } from "@/api/users"
import { mapAnnouncement } from "@/api/announcements"

export type ConnectionStatus = "connecting" | "connected" | "disconnected"

/** Phones use the mobile shell and must never show kiosk update prompts. */
const isDisplayClient = typeof navigator === "undefined"
  || !/Mobi|Android|iPhone|iPad/i.test(navigator.userAgent)

const connected        = ref(false)
const status           = ref<ConnectionStatus>("disconnected")
const reconnectAttempt = ref(0)

let eventSource:    EventSource | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
const maxBackoff = 30000

/** How many times the stream has opened, and how many resyncs the server has asked for. */
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
/** Coalesce overlapping resync triggers into a single reload. */
function requestRefresh() {
  if (!refreshInFlight) {
    refreshInFlight = refreshAllStores().finally(() => { refreshInFlight = null })
  }
  return refreshInFlight
}

/** Let the software-update card follow state changes made on another client. */
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

  // The server subscribes us to the household channel and immediately asks for a
  // resync. The first request is the page's initial connect (already covered by
  // the mount-time fetches); anything after that means we were disconnected —
  // server restart, network blip — and may have missed events.
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
      // Theme, accent, text size, warm lighting, notification prefs and the
      // room name all ride this event — apply them live so every screen in the
      // fleet follows a change made on any other client.
      applyHouseholdSettings(settings)
      if (settings.widgetLayout) {
        window.dispatchEvent(new CustomEvent("homst:widget-layout-updated", { detail: settings.widgetLayout }))
      }
      // Update-check preferences changed on another screen; refresh the card.
      if (settings.updates) notifyUpdateChanged()
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
    // Ignore late errors from a stream that a newer connect() already replaced.
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
