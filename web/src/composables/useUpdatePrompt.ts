import { ref } from "vue"
import { systemApi } from "@/api/system"

export interface UpdatePromptInfo {
  version: string
  major: boolean
  htmlUrl: string | null
}

interface UpdateAvailablePayload {
  version?: unknown
  major?: unknown
  html_url?: unknown
}

const ACTIVE_STATES = new Set(["queued", "pulling", "restarting", "verifying", "rolling_back"])

const prompt = ref<UpdatePromptInfo | null>(null)
const busy = ref(false)
const installing = ref(false)
const error = ref("")

/** Set after the user declines; also suppresses a late event from the server. */
let localDismissed: string | null = null
let jobTimer: ReturnType<typeof setTimeout> | null = null
let pollFailures = 0

function stopPolling() {
  if (jobTimer) {
    clearTimeout(jobTimer)
    jobTimer = null
  }
  pollFailures = 0
}

function clear() {
  stopPolling()
  prompt.value = null
  error.value = ""
  installing.value = false
}

function offer(payload: UpdateAvailablePayload) {
  const version = typeof payload.version === "string" ? payload.version : ""
  if (!version || localDismissed === version) return

  const next: UpdatePromptInfo = {
    version,
    major: !!payload.major,
    htmlUrl: typeof payload.html_url === "string" ? payload.html_url : null,
  }

  // Re-delivery of the same release should not reset an install in progress.
  if (prompt.value?.version === version) {
    prompt.value = { ...prompt.value, ...next }
    return
  }

  prompt.value = next
  installing.value = false
  error.value = ""
}

/** Read the current release state; used on mount and after a reconnect. */
async function refresh() {
  if (busy.value) return
  try {
    const status = await systemApi.getStatus()
    if (!status || !status.current) return

    // A failed update leaves the old version running. Drop the spinner and
    // show the updater's error instead of waiting forever.
    if (installing.value && status.job) {
      if (status.job.state === "failed" || status.job.state === "rolled_back") {
        installing.value = false
        stopPolling()
        error.value = status.job.error || "The update could not be installed."
      }
    }

    const info = status.update_prompt
    if (!info || !info.version) {
      if (installing.value) {
        const state = status.job?.state
        if (state && ACTIVE_STATES.has(state)) return
      }
      clear()
      return
    }

    offer({
      version: info.version,
      major: status.latest?.major,
      html_url: status.latest?.html_url,
    })
  } catch {
    // Status is best-effort; the SSE event may still arrive.
  }
}

async function pollJob() {
  jobTimer = null
  if (!installing.value) return

  try {
    const data = await systemApi.getJob()
    pollFailures = 0
    const job = data.job

    if (!job) {
      jobTimer = setTimeout(pollJob, 2000)
      return
    }
    if (ACTIVE_STATES.has(job.state)) {
      jobTimer = setTimeout(pollJob, 2000)
      return
    }

    if (job.state === "failed" || job.state === "rolled_back") {
      installing.value = false
      error.value = job.error || "The update could not be installed."
      return
    }

    // Success: the API restarted. Re-check status to clear the prompt.
    await refresh()
  } catch {
    // The app is restarting; keep the installing card visible and retry.
    pollFailures += 1
    if (pollFailures >= 120) {
      installing.value = false
      error.value = "HOMST did not come back after the restart. Check the updater logs."
      return
    }
    jobTimer = setTimeout(pollJob, 2000)
  }
}

/** Install the offered release; the UI stays visible until the restart. */
async function accept() {
  const current = prompt.value
  if (!current || busy.value || installing.value) return

  busy.value = true
  installing.value = true
  error.value = ""
  try {
    await systemApi.install(current.version)
    jobTimer = setTimeout(pollJob, 2000)
  } catch (exc) {
    installing.value = false
    error.value = exc instanceof Error ? exc.message : "Could not start the update."
  } finally {
    busy.value = false
  }
}

/** Decline the offered release for now; it stays available in Settings. */
async function decline() {
  const current = prompt.value
  if (!current || busy.value || installing.value) return

  busy.value = true
  error.value = ""
  try {
    await systemApi.dismissPrompt(current.version)
    localDismissed = current.version
    clear()
  } catch (exc) {
    error.value = exc instanceof Error ? exc.message : "Could not dismiss the reminder."
  } finally {
    busy.value = false
  }
}

function handleDismissed(version: unknown) {
  if (typeof version !== "string") return
  if (prompt.value?.version === version) clear()
}

function handleStarting(version: unknown) {
  // An install started from this prompt keeps its "installing" state.
  if (installing.value && (typeof version !== "string" || prompt.value?.version === version)) {
    return
  }
  clear()
}

export function useUpdatePrompt() {
  return { prompt, busy, installing, error, offer, refresh, accept, decline }
}

export function offerUpdatePrompt(payload: UpdateAvailablePayload) {
  offer(payload)
}

export function updatePromptDismissed(version: unknown) {
  handleDismissed(version)
}

export function updatePromptStarting(version: unknown) {
  handleStarting(version)
}

export function refreshUpdatePrompt() {
  return refresh()
}

export function clearUpdatePrompt() {
  clear()
}

export function stopUpdatePromptPolling() {
  stopPolling()
}

export function _resetUpdatePrompt() {
  stopPolling()
  prompt.value = null
  busy.value = false
  installing.value = false
  error.value = ""
  localDismissed = null
}
