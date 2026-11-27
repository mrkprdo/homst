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
  auto_install?: unknown
}

const ACTIVE_STATES = new Set(["queued", "pulling", "restarting", "verifying", "rolling_back"])

const prompt = ref<UpdatePromptInfo | null>(null)
const busy = ref(false)
const installing = ref(false)
const error = ref("")
const autoInstall = ref(false)
const countdown = ref<number | null>(null)

export const AUTO_INSTALL_SECONDS = 60

let countdownTimer: ReturnType<typeof setInterval> | null = null

let localDismissed: string | null = null
let jobTimer: ReturnType<typeof setTimeout> | null = null
let failingSince = 0

let pageIdentity: string | null = null
const RELOADED_FOR_KEY = "homst:update:reloaded-for"

function serverIdentity(current: { version?: unknown; commit?: unknown }): string {
  const version = typeof current.version === "string" ? current.version : ""
  const commit = typeof current.commit === "string" ? current.commit : ""
  return `${version}:${commit}`
}

function reloadForRelease(identity: string): boolean {
  try {
    if (sessionStorage.getItem(RELOADED_FOR_KEY) === identity) return false
    sessionStorage.setItem(RELOADED_FOR_KEY, identity)
  } catch {
    return false
  }
  clear()
  window.location.reload()
  return true
}

const TIMEOUT_RELOADED_KEY = "homst:update:timeout-reloaded"

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

function stopCountdown() {
  if (countdownTimer) {
    clearInterval(countdownTimer)
    countdownTimer = null
  }
  countdown.value = null
}

function startCountdown() {
  if (countdownTimer !== null || countdown.value !== null) return
  if (!autoInstall.value || !prompt.value || installing.value || busy.value) return

  countdown.value = AUTO_INSTALL_SECONDS
  countdownTimer = setInterval(() => {
    if (!autoInstall.value || !prompt.value || installing.value) {
      stopCountdown()
      return
    }
    const next = (countdown.value ?? 0) - 1
    if (next <= 0) {
      stopCountdown()
      void accept()
      return
    }
    countdown.value = next
  }, 1000)
}

export function setUpdateAutoInstall(enabled: boolean) {
  autoInstall.value = !!enabled
  if (!autoInstall.value) {
    stopCountdown()
    return
  }
  startCountdown()
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

function showInstalling(version: string) {
  stopCountdown()
  if (prompt.value?.version !== version) {
    prompt.value = { version, major: false, htmlUrl: null }
  }
  installing.value = true
  error.value = ""
  startPolling()
}

function clear() {
  stopPolling()
  stopCountdown()
  prompt.value = null
  error.value = ""
  installing.value = false
}

function offer(payload: UpdateAvailablePayload) {
  const version = typeof payload.version === "string" ? payload.version : ""
  if (!version || localDismissed === version) return

  if (typeof payload.auto_install === "boolean") {
    autoInstall.value = payload.auto_install
  }
  if (!autoInstall.value) stopCountdown()

  const next: UpdatePromptInfo = {
    version,
    major: !!payload.major,
    htmlUrl: typeof payload.html_url === "string" ? payload.html_url : null,
  }

  if (prompt.value?.version === version) {
    prompt.value = { ...prompt.value, ...next }
    startCountdown()
    return
  }

  prompt.value = next
  installing.value = false
  error.value = ""
  stopCountdown()
  startCountdown()
}

async function refresh(): Promise<boolean> {
  if (busy.value) return false
  try {
    const status = await systemApi.getStatus()
    if (!status || !status.current) return false

    const prefs = status.auto
    if (prefs && typeof prefs.autoInstall === "boolean") {
      setUpdateAutoInstall(prefs.autoInstall)
    }

    const job = status.job
    const activeJob = !!job && ACTIVE_STATES.has(job.state)

    const identity = serverIdentity(status.current)
    if (pageIdentity === null) {
      pageIdentity = identity
    } else if (identity !== pageIdentity && !activeJob) {
      if (job?.id && job.state === "success") acknowledgeUpdateJob(job.id)
      if (!reloadForRelease(identity)) clear()
      return true
    }

    if (installing.value && job) {
      if (job.state === "failed" || job.state === "rolled_back") {
        installing.value = false
        stopPolling()
        error.value = job.error || "The update could not be installed."
      }
    }

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

    const verified = await refresh()
    if (!verified) jobTimer = setTimeout(pollJob, 2000)
  } catch {
    const now = Date.now()
    if (!failingSince) failingSince = now
    if (now - failingSince >= 4 * 60 * 1000) {
      installing.value = false
      if (reloadAfterTimeout(prompt.value?.version ?? "")) return
      error.value = "HOMST did not come back after the restart. Reload this screen or check the updater logs."
      return
    }
    jobTimer = setTimeout(pollJob, 2000)
  }
}

async function accept() {
  const current = prompt.value
  if (!current || busy.value || installing.value) return

  stopCountdown()
  busy.value = true
  installing.value = true
  error.value = ""
  try {
    await systemApi.install(current.version)
    startPolling()
  } catch (exc) {
    const message = exc instanceof Error ? exc.message : "Could not start the update."
    if (/already in progress/i.test(message)) {
      installing.value = true
      error.value = ""
      startPolling()
      return
    }
    installing.value = false
    error.value = message
  } finally {
    busy.value = false
  }
}

async function decline() {
  const current = prompt.value
  if (!current || busy.value || installing.value) return

  stopCountdown()
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
  showInstalling(version)
}

export function useUpdatePrompt() {
  return { prompt, busy, installing, error, autoInstall, countdown, offer, refresh, accept, decline }
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

export function stopUpdatePromptPolling() {
  stopPolling()
}

export function stopUpdatePromptCountdown() {
  stopCountdown()
}

export function _resetUpdatePrompt() {
  stopPolling()
  stopCountdown()
  prompt.value = null
  busy.value = false
  installing.value = false
  error.value = ""
  autoInstall.value = false
  localDismissed = null
  pageIdentity = null
}
