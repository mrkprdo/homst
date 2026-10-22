import { ref } from "vue"
import { systemApi } from "@/api/system"
import { acknowledgeUpdateJob } from "@/lib/updateJob"

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
/** When the current run of failed status polls began, in ms. */
let failingSince = 0

/**
 * Build identity the screen was running when it loaded. The web assets and the
 * API ship in the same image, so a change means the server restarted on a new
 * release and this screen must reload to pick up the matching frontend.
 */
let pageIdentity: string | null = null
const RELOADED_FOR_KEY = "homst:update:reloaded-for"

function serverIdentity(current: { version?: unknown; commit?: unknown }): string {
  const version = typeof current.version === "string" ? current.version : ""
  const commit = typeof current.commit === "string" ? current.commit : ""
  return `${version}:${commit}`
}

/** Reload once per server release; a stale service-worker cache must not loop. */
function reloadForRelease(identity: string): boolean {
  try {
    if (sessionStorage.getItem(RELOADED_FOR_KEY) === identity) return false
    sessionStorage.setItem(RELOADED_FOR_KEY, identity)
  } catch {
    // Without storage we cannot tell a reload from the one that just happened.
    return false
  }
  clear()
  window.location.reload()
  return true
}

const TIMEOUT_RELOADED_KEY = "homst:update:timeout-reloaded"

/**
 * Last resort when the server cannot be reached for minutes: the page may be
 * wedged on connections opened before the restart, which a fresh load fixes.
 */
function reloadAfterTimeout(version: string): boolean {
  const marker = version || "install"
  try {
    if (sessionStorage.getItem(TIMEOUT_RELOADED_KEY) === marker) return false
    sessionStorage.setItem(TIMEOUT_RELOADED_KEY, marker)
  } catch {
    return false
  }
  window.location.reload()
  return true
}

function stopPolling() {
  if (jobTimer) {
    clearTimeout(jobTimer)
    jobTimer = null
  }
  failingSince = 0
}

function startPolling() {
  if (jobTimer) return
  jobTimer = setTimeout(pollJob, 2000)
}

/** An install started on any display is shown on every display. */
function showInstalling(version: string) {
  if (prompt.value?.version !== version) {
    prompt.value = { version, major: false, htmlUrl: null }
  }
  installing.value = true
  error.value = ""
  startPolling()
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
async function refresh(): Promise<boolean> {
  if (busy.value) return false
  try {
    const status = await systemApi.getStatus()
    if (!status || !status.current) return false

    const job = status.job
    const activeJob = !!job && ACTIVE_STATES.has(job.state)

    const identity = serverIdentity(status.current)
    if (pageIdentity === null) {
      pageIdentity = identity
    } else if (identity !== pageIdentity && !activeJob) {
      // The server restarted on another release while this screen was open.
      // Acknowledge a finished update first so the settings card does not offer
      // a reload that already happened, then load the matching frontend.
      if (job?.id && job.state === "success") acknowledgeUpdateJob(job.id)
      if (!reloadForRelease(identity)) clear()
      return true
    }

    // A failed update leaves the old version running. Drop the spinner and
    // show the updater's error instead of waiting forever.
    if (installing.value && job) {
      if (job.state === "failed" || job.state === "rolled_back") {
        installing.value = false
        stopPolling()
        error.value = job.error || "The update could not be installed."
      }
    }

    // A client that was closed, reloaded or reconnected mid-install should
    // still show the same installing state as the display that started it.
    const installingVersion = job?.to_version || job?.version
    if (job && installingVersion && ACTIVE_STATES.has(job.state)) {
      showInstalling(installingVersion)
      return true
    }

    const info = status.update_prompt
    if (!info || !info.version) {
      if (installing.value) {
        const state = status.job?.state
        if (state && ACTIVE_STATES.has(state)) return true
      }
      clear()
      return true
    }

    offer({
      version: info.version,
      major: status.latest?.major,
      html_url: status.latest?.html_url,
    })
    return true
  } catch {
    // Status is best-effort; the caller may retry while an install finishes.
    return false
  }
}

async function pollJob() {
  jobTimer = null
  if (!installing.value) return

  try {
    const data = await systemApi.getJob()
    failingSince = 0
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

    // Success: the API restarted. Re-check status to clear the prompt; if the
    // new server is not ready yet, keep polling instead of leaving the
    // "installing" card up forever.
    const verified = await refresh()
    if (!verified) jobTimer = setTimeout(pollJob, 2000)
  } catch {
    // The app is restarting; keep the installing card visible and retry.
    const now = Date.now()
    if (!failingSince) failingSince = now
    // The API is only unreachable while the container is recreated (< 3 min
    // including its health check). Past that, a fresh load is the best repair.
    if (now - failingSince >= 4 * 60 * 1000) {
      installing.value = false
      if (reloadAfterTimeout(prompt.value?.version ?? "")) return
      error.value = "HOMST did not come back after the restart. Reload this screen or check the updater logs."
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
    startPolling()
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
  if (installing.value) return
  localDismissed = version
  if (prompt.value?.version === version) clear()
}

function handleStarting(version: unknown) {
  if (typeof version !== "string" || !version) return
  // The client that accepted already has the prompt (with its release
  // metadata); the others open the same installing card.
  showInstalling(version)
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
  pageIdentity = null
}
