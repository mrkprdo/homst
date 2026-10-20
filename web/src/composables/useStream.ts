import { ref, onMounted, onUnmounted } from "vue"
import { useEvents } from "@/composables/useEvents"
import { useTasks } from "@/composables/useTasks"
import { useMembers } from "@/composables/useMembers"
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
  const { refreshFromServer: refreshSettings } = useSettings()
  await Promise.allSettled([
    refreshEvents(),
    refreshTasks(),
    refreshMembers(),
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

function connect() {
  disconnect()
  status.value = "connecting"
  eventSource = new EventSource("/api/stream")

  const { upsertEvent, removeEvent } = useEvents()
  const { upsertTask,  removeTask  } = useTasks()
  const { upsertMember, removeMember } = useMembers()
  const { push: pushNotification } = useNotifications()

  eventSource.onopen = () => {
    opens++
    connected.value = true
    status.value = "connected"
    reconnectAttempt.value = 0
  }

  // The server subscribes us to the household channel and immediately asks for a
  // resync. The first request is the page's initial connect (already covered by
  // the mount-time fetches); anything after that means we were disconnected —
  // server restart, network blip — and may have missed events.
  eventSource.addEventListener("sync.required", () => {
    syncFrames++
    if (opens > 1 || syncFrames > 1) requestRefresh()
  })

  eventSource.addEventListener("event.created", (e) => {
    try { upsertEvent(mapEvent(JSON.parse(e.data))) } catch {}
  })
  eventSource.addEventListener("event.updated", (e) => {
    try { upsertEvent(mapEvent(JSON.parse(e.data))) } catch {}
  })
  eventSource.addEventListener("event.deleted", (e) => {
    try { const { id } = JSON.parse(e.data); removeEvent(id) } catch {}
  })
  eventSource.addEventListener("task.created", (e) => {
    try { upsertTask(mapTask(JSON.parse(e.data))) } catch {}
  })
  eventSource.addEventListener("task.updated", (e) => {
    try { upsertTask(mapTask(JSON.parse(e.data))) } catch {}
  })
  eventSource.addEventListener("task.deleted", (e) => {
    try { const { id } = JSON.parse(e.data); removeTask(id) } catch {}
  })
  eventSource.addEventListener("member.joined", (e) => {
    try { upsertMember(mapMember(JSON.parse(e.data))) } catch {}
  })
  eventSource.addEventListener("member.updated", (e) => {
    try { upsertMember(mapMember(JSON.parse(e.data))) } catch {}
  })
  eventSource.addEventListener("member.removed", (e) => {
    try { const { id } = JSON.parse(e.data); removeMember(id) } catch {}
  })
  eventSource.addEventListener("settings.updated", (e) => {
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
    } catch {}
  })
  eventSource.addEventListener("photos.updated", () => {
    void refreshPhotos()
  })
  eventSource.addEventListener("reminder.due", (e) => {
    try { pushNotification(JSON.parse(e.data)) } catch {}
  })
  eventSource.addEventListener("system.update.available", (e) => {
    if (!isDisplayClient) return
    try { offerUpdatePrompt(JSON.parse(e.data)) } catch {}
  })
  eventSource.addEventListener("system.update.dismissed", (e) => {
    if (!isDisplayClient) return
    try { updatePromptDismissed(JSON.parse(e.data).version) } catch {}
  })
  eventSource.addEventListener("system.update.starting", (e) => {
    if (!isDisplayClient) return
    try { updatePromptStarting(JSON.parse(e.data).version) } catch {}
  })

  eventSource.onerror = () => {
    connected.value = false
    status.value = "disconnected"
    eventSource?.close()
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
