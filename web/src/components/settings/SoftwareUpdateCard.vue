<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue"
import {
  PhArrowsClockwise,
  PhCheckCircle,
  PhClock,
  PhArrowCounterClockwise,
  PhWarningCircle,
} from "@phosphor-icons/vue"
import { systemApi, type SystemJob, type SystemRelease, type SystemStatus } from "@/api/system"
import { householdApi, type UpdatePreferences } from "@/api/household"
import UiButton from "@/components/ui/UiButton.vue"
import UiToggle from "@/components/ui/UiToggle.vue"
import UiBadge from "@/components/ui/UiBadge.vue"
import { DISMISSED_UPDATE_JOB_KEY, acknowledgeUpdateJob } from "@/lib/updateJob"

const ACTIVE_STATES = new Set(["queued", "pulling", "restarting", "verifying", "rolling_back"])

const status = ref<SystemStatus | null>(null)
const loading = ref(true)
const checking = ref(false)
const error = ref("")
const job = ref<SystemJob | null>(null)
const pendingVersion = ref<string | null>(null)
const savingAuto = ref(false)
const autoMessage = ref("")
const starting = ref(false)
const auto = ref<UpdatePreferences>({
  enabled: true,
  checkIntervalMinutes: 5,
})
const restarting = ref(false)

let pollTimer: ReturnType<typeof setTimeout> | null = null
let pollFailures = 0
let dismissedJob = ""

const current = computed(() => status.value?.current ?? {
  version: "unknown",
  commit: "",
  image: null,
  tag: null,
  digest: null,
  channel: "stable" as const,
})
const selfUpdate = computed(() => status.value?.self_update ?? {
  available: false,
  managed: false,
  reason: "Update information is unavailable.",
  mode: "manual" as const,
})
const managed = computed(() => !!status.value && selfUpdate.value.available && selfUpdate.value.managed)
const manualMode = computed(() => !!status.value && !managed.value)
const latest = computed<SystemRelease | null>(() => status.value?.latest ?? null)
const releases = computed<SystemRelease[]>(() => status.value?.releases ?? [])
const held = computed(() => status.value?.held ?? { version: null, reason: null })
const pendingRelease = computed<SystemRelease | null>(() =>
  pendingVersion.value ? releases.value.find((release) => release.version === pendingVersion.value) ?? null : null,
)
const history = computed(() => {
  const list = releases.value.slice(0, 6)
  if (held.value.version && !list.some((release) => release.version === held.value.version)) {
    const heldRelease = releases.value.find((release) => release.version === held.value.version)
    if (heldRelease) list.push(heldRelease)
  }
  return list
})
const updateAvailable = computed(() => !!status.value?.update_available && !!latest.value)
const currentVersion = computed(() => current.value.version)
const channelLabel = computed(() => {
  const labels: Record<string, string> = {
    stable: "Stable",
    nightly: "Nightly",
    pinned: "Pinned",
    custom: "Custom",
  }
  return labels[current.value.channel] ?? "Stable"
})
const jobActive = computed(() => !!job.value && ACTIVE_STATES.has(job.value.state))
const busy = computed(() => starting.value || jobActive.value)
const jobPercent = computed(() => {
  const percent = job.value?.progress?.percent ?? 0
  return Math.max(0, Math.min(100, Math.round(percent)))
})
const jobTone = computed(() => {
  if (!job.value) return "info"
  if (job.value.state === "success" || job.value.state === "up_to_date") return "success"
  if (job.value.state === "failed") return "danger"
  if (job.value.state === "rolled_back") return "warning"
  return "info"
})
const manualTitle = computed(() => {
  if (!selfUpdate.value.available) return "In-app updates are not enabled"
  if (current.value.channel === "nightly") return "Nightly build"
  if (current.value.channel === "pinned") return "Pinned version"
  if (current.value.channel === "custom") return "Custom image"
  return "Manual updates"
})
const shortCommit = computed(() => current.value.commit.slice(0, 7))
const checkedLabel = computed(() => status.value?.checked_at ? formatDate(status.value.checked_at) : "")

function formatDate(value: string | null | undefined): string {
  if (!value) return ""
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ""
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

function applyJob(next: SystemJob | null) {
  if (!next) {
    job.value = null
    return
  }
  if (next.id === dismissedJob && !ACTIVE_STATES.has(next.state)) {
    job.value = null
    return
  }
  if (!ACTIVE_STATES.has(next.state) && next.finished_at) {
    const finished = new Date(next.finished_at).getTime()
    if (Number.isFinite(finished) && Date.now() - finished > 24 * 60 * 60 * 1000) {
      job.value = null
      return
    }
  }
  job.value = next
  if (ACTIVE_STATES.has(next.state)) {
    pollFailures = 0
    startPolling()
  }
}

async function load(refresh = false) {
  if (refresh) checking.value = true
  else if (!status.value) loading.value = true
  error.value = ""
  try {
    const data = await systemApi.getStatus(refresh)
    if (!data || !data.current) {
      error.value = "Update information is unavailable."
      return
    }
    status.value = data
    auto.value = { ...auto.value, ...(data.auto ?? {}) }
    applyJob(data.job ?? null)
  } catch (exc) {
    error.value = exc instanceof Error ? exc.message : "Could not check for updates."
  } finally {
    loading.value = false
    checking.value = false
  }
}

async function check() {
  await load(true)
}

async function startInstall(version: string, retry = false) {
  pendingVersion.value = null
  error.value = ""
  dismissedJob = ""
  starting.value = true
  try {
    const created = await systemApi.install(version, retry)
    applyJob(created)
    restarting.value = false
  } catch (exc) {
    error.value = exc instanceof Error ? exc.message : "Could not start the update."
  } finally {
    starting.value = false
  }
}

function startPolling() {
  if (pollTimer) return
  pollTimer = setTimeout(poll, 1500)
}

async function poll() {
  pollTimer = null
  try {
    const data = await systemApi.getJob()
    pollFailures = 0
    restarting.value = false
    applyJob(data.job ?? null)
    if (data.job && ACTIVE_STATES.has(data.job.state)) {
      startPolling()
      return
    }
    await load()
  } catch {
    // The app is restarting; keep the last known phase visible and retry.
    pollFailures += 1
    restarting.value = true
    if (pollFailures >= 180) {
      restarting.value = false
      error.value = "HOMST did not come back after the restart. Check the updater logs."
      return
    }
    pollTimer = setTimeout(poll, 2000)
  }
}

function rememberDismissedJob() {
  if (!job.value) return
  dismissedJob = job.value.id
  acknowledgeUpdateJob(dismissedJob)
}

function dismissJob() {
  rememberDismissedJob()
  job.value = null
}

function reloadPage() {
  // The server keeps reporting the finished job, so a plain reload would
  // bring the "update complete" notice straight back. A reload applies the
  // update — acknowledge the job first, exactly like Dismiss does.
  rememberDismissedJob()
  window.location.reload()
}

function onAutoToggle(enabled: boolean) {
  auto.value = { ...auto.value, enabled: !!enabled }
  saveAuto()
}

function onIntervalChange(event: Event) {
  const minutes = Number((event.target as HTMLSelectElement).value)
  if (!Number.isFinite(minutes) || minutes < 1) return
  auto.value = { ...auto.value, checkIntervalMinutes: minutes }
  saveAuto()
}

async function saveAuto() {
  savingAuto.value = true
  autoMessage.value = ""
  try {
    await householdApi.updateSettings({ updates: { ...auto.value } })
    autoMessage.value = "Saved."
  } catch {
    autoMessage.value = "Could not save update-check settings."
  } finally {
    savingAuto.value = false
  }
}

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    autoMessage.value = "Command copied."
  } catch {
    autoMessage.value = "Copy failed — select the command manually."
  }
}

function releaseBadge(release: SystemRelease): string {
  if (release.current) return "Current"
  if (release.held) return "Held"
  if (release.latest) return "Latest"
  if (release.previous) return "Previous"
  return release.newer ? "Newer" : "Older"
}

function badgeVariant(release: SystemRelease): "primary" | "success" | "warning" | "neutral" {
  if (release.current) return "success"
  if (release.held) return "warning"
  if (release.latest) return "primary"
  return "neutral"
}

function jobTitle(next: SystemJob): string {
  const titles: Record<string, string> = {
    queued: "Queued",
    pulling: "Downloading update",
    restarting: "Restarting HOMST",
    verifying: "Starting the new version",
    rolling_back: "Restoring the previous version",
    success: "Update complete",
    up_to_date: "Already up to date",
    rolled_back: "Update rolled back",
    failed: "Update failed",
  }
  return titles[next.state] ?? "Update"
}

function onUpdateChanged() {
  // Another display started, dismissed or finished an update; mirror it here.
  void load()
}

onMounted(() => {
  try { dismissedJob = localStorage.getItem(DISMISSED_UPDATE_JOB_KEY) ?? "" } catch { /* ignore */ }
  window.addEventListener("homst:update-changed", onUpdateChanged)
  load()
})

onUnmounted(() => {
  if (pollTimer) clearTimeout(pollTimer)
  window.removeEventListener("homst:update-changed", onUpdateChanged)
})
</script>

<template>
  <div class="update-card settings-card">
    <div class="update-head">
      <div>
        <h3 class="update-title">Software update</h3>
        <p class="update-sub">Official stable releases only</p>
      </div>
      <span class="channel-badge" :class="`channel-badge--${current.channel}`">{{ channelLabel }}</span>
    </div>

    <div v-if="loading && !status" class="update-loading">Checking the current version…</div>

    <template v-else-if="status">
      <div class="version-line">
        <span class="version-number">HOMST {{ currentVersion }}</span>
        <span v-if="shortCommit" class="version-commit">{{ shortCommit }}</span>
        <span v-if="current.tag" class="version-tag">{{ current.tag }}</span>
      </div>

      <div v-if="manualMode" class="update-note">
        <div class="note-heading">
          <PhClock :size="17" />
          <strong>{{ manualTitle }}</strong>
        </div>
        <p class="card-desc">{{ selfUpdate.reason }}</p>
        <p v-if="latest" class="card-desc">
          Latest stable: <strong>HOMST {{ latest.version }}</strong>
        </p>
        <pre class="command">{{ status?.manual?.current }}</pre>
        <div class="note-actions">
          <UiButton size="sm" variant="ghost" @click="copy(status?.manual?.current ?? '')">Copy command</UiButton>
          <UiButton size="sm" variant="ghost" :disabled="checking" @click="check">
            <PhArrowsClockwise :size="14" :class="{ spinning: checking }" />
            {{ checking ? "Checking…" : "Check again" }}
          </UiButton>
        </div>
        <template v-if="current.channel === 'nightly' || current.channel === 'pinned'">
          <p class="card-desc">Stable channel:</p>
          <pre class="command">{{ status?.manual?.stable }}</pre>
        </template>
      </div>

      <template v-else>
        <div v-if="error" class="update-error" role="alert">{{ error }}</div>

        <div v-if="updateAvailable && latest" class="latest-box">
          <div>
            <p class="latest-title">HOMST {{ latest.version }} is available</p>
            <p class="update-sub">
              Published {{ formatDate(latest.published_at) || "recently" }}
              <span v-if="latest.major" class="major-warning">· major version</span>
            </p>
          </div>
          <UiButton size="sm" :disabled="busy" @click="pendingVersion = latest.version">{{ latest.held ? "Retry" : "Update" }}</UiButton>
        </div>
        <div v-else-if="status && !status.error" class="up-to-date">
          <PhCheckCircle :size="18" weight="fill" />
          <span>You're on the latest stable release.</span>
        </div>

        <p v-if="status?.error" class="card-desc update-stale">{{ status.error }}</p>

        <div v-if="held.version" class="update-note update-note--warning">
          <div class="note-heading">
            <PhWarningCircle :size="17" />
            <strong>HOMST {{ held.version }} was rolled back.</strong>
          </div>
          <p class="card-desc">It is skipped until a newer release or an explicit retry.</p>
        </div>

        <div class="update-actions">
          <UiButton size="sm" variant="ghost" :disabled="checking || busy" @click="check">
            <PhArrowsClockwise :size="14" :class="{ spinning: checking }" />
            {{ checking ? "Checking…" : "Check for updates" }}
          </UiButton>
          <span v-if="checkedLabel" class="checked-at">Checked {{ checkedLabel }}</span>
        </div>

        <div v-if="history.length" class="update-history">
          <p class="section-label">Version history</p>
          <div v-for="release in history" :key="release.version" class="release-row">
            <div class="release-main">
              <span class="release-version">HOMST {{ release.version }}</span>
              <UiBadge :variant="badgeVariant(release)">{{ releaseBadge(release) }}</UiBadge>
              <span class="release-date">{{ formatDate(release.published_at) }}</span>
            </div>
            <div class="release-actions">
              <UiButton
                v-if="release.held"
                size="sm"
                variant="ghost"
                :disabled="busy"
                @click="startInstall(release.version, true)"
              >
                Retry
              </UiButton>
              <UiButton
                v-else-if="!release.current"
                size="sm"
                variant="ghost"
                :disabled="busy"
                @click="pendingVersion = release.version"
              >
                {{ release.newer ? "Update" : "Roll back" }}
              </UiButton>
              <a v-if="release.html_url" class="release-link" :href="release.html_url" target="_blank" rel="noreferrer">
                Notes
              </a>
            </div>
          </div>
        </div>

        <div class="auto-update">
          <div class="auto-row">
            <div>
              <p class="row-title">Automatic checks</p>
              <p class="card-desc">Look for new stable releases and ask on connected displays.</p>
            </div>
            <UiToggle
              :model-value="auto.enabled"
              :disabled="savingAuto"
              @update:model-value="onAutoToggle"
            />
          </div>
          <div v-if="auto.enabled" class="auto-window">
            <label class="time-field">
              <span>Every</span>
              <select :value="auto.checkIntervalMinutes" @change="onIntervalChange">
                <option :value="5">5 minutes</option>
                <option :value="15">15 minutes</option>
                <option :value="30">30 minutes</option>
                <option :value="60">1 hour</option>
              </select>
            </label>
          </div>
          <p class="card-desc">
            Displays show a Yes/No reminder when a new version is available. Choosing No hides
            that reminder; the release stays available here.
          </p>
          <p v-if="autoMessage" class="card-desc auto-message">{{ autoMessage }}</p>
        </div>
      </template>

      <div v-if="pendingRelease" class="confirm-box">
        <PhWarningCircle :size="20" class="confirm-icon" />
        <div class="confirm-copy">
          <p class="confirm-title">
            {{ pendingRelease.held ? "Retry" : (pendingRelease.newer ? "Install" : "Roll back to") }}
            HOMST {{ pendingRelease.version }}?
          </p>
          <p class="card-desc">
            HOMST will restart and reconnect automatically.
          </p>
          <p v-if="pendingRelease.major" class="card-desc major-warning">
            Major update — review the release notes and back up first.
          </p>
        </div>
        <div class="confirm-actions">
          <UiButton size="sm" variant="ghost" @click="pendingVersion = null">Cancel</UiButton>
          <UiButton size="sm" :disabled="busy" @click="startInstall(pendingRelease.version, pendingRelease.held)">
            <PhArrowCounterClockwise v-if="!pendingRelease.newer" :size="14" />
            {{ pendingRelease.held ? "Retry" : (pendingRelease.newer ? "Install" : "Roll back") }}
          </UiButton>
        </div>
      </div>

      <div v-if="job" class="job-box" :class="`job-box--${jobTone}`" aria-live="polite">
        <div class="job-head">
          <strong>{{ jobTitle(job) }}</strong>
          <span v-if="jobActive && job.state === 'pulling'" class="job-percent">{{ jobPercent }}%</span>
        </div>
        <div v-if="jobActive && job.state === 'pulling'" class="progress-track">
          <div class="progress-fill" :style="{ width: `${jobPercent}%` }" />
        </div>
        <p class="card-desc job-message">{{ job.message }}</p>
        <p v-if="restarting" class="card-desc job-message">Waiting for HOMST to come back…</p>
        <p v-if="job.error && !jobActive" class="card-desc job-error">{{ job.error }}</p>
        <div v-if="!jobActive" class="job-actions">
          <UiButton v-if="job.state === 'success' || job.state === 'up_to_date'" size="sm" @click="reloadPage">
            Reload
          </UiButton>
          <UiButton size="sm" variant="ghost" @click="dismissJob">Dismiss</UiButton>
        </div>
      </div>
    </template>

    <div v-else class="update-actions">
      <p class="update-error">{{ error || "Update information is unavailable." }}</p>
      <UiButton size="sm" variant="ghost" @click="load()">Retry</UiButton>
    </div>
  </div>
</template>

<style scoped>
.update-card {
  background: var(--color-bgSurface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  padding: var(--space-5);
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.update-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-3);
}

.update-title {
  font-size: var(--text-body-size);
  font-weight: var(--font-weight-medium);
  color: var(--color-textPrimary);
}

.update-sub {
  font-size: var(--text-label-size);
  color: var(--color-textMuted);
  margin-top: var(--space-1);
}

.card-desc {
  font-size: var(--text-label-size);
  color: var(--color-textMuted);
  margin-top: var(--space-1);
}

.channel-badge {
  font-size: var(--text-label-size);
  font-weight: var(--font-weight-medium);
  padding: 2px var(--space-2);
  border-radius: var(--radius-full);
  background: var(--color-accent-lighter);
  color: var(--color-primary);
  white-space: nowrap;
  flex-shrink: 0;
}

.channel-badge--nightly { background: var(--color-bgSubtle); color: var(--color-textMuted); }
.channel-badge--pinned { background: var(--color-accent-lighter); color: var(--color-accent-darker); }
.channel-badge--custom { background: var(--color-bgSubtle); color: var(--color-textMuted); }

.update-loading { font-size: var(--text-label-size); color: var(--color-textMuted); }

.version-line {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
  flex-wrap: wrap;
}

.version-number {
  font-family: var(--font-heading);
  font-size: var(--text-heading-size);
  color: var(--color-textPrimary);
}

.version-commit,
.version-tag {
  font-size: var(--text-micro-size);
  color: var(--color-textMuted);
  font-family: var(--font-mono, monospace);
  background: var(--color-bgSubtle);
  padding: 1px 6px;
  border-radius: var(--radius-full);
}

.latest-box {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
  border: 1px solid var(--color-primary);
  border-radius: var(--radius-md);
  background: var(--color-accent-lighter);
}

.latest-title { font-size: var(--text-body-size); font-weight: var(--font-weight-medium); color: var(--color-primary); }
.major-warning { color: var(--color-warning); font-weight: var(--font-weight-medium); }

.up-to-date {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  color: var(--color-success);
  font-size: var(--text-label-size);
}

.update-actions {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  flex-wrap: wrap;
}

.checked-at { font-size: var(--text-micro-size); color: var(--color-textMuted); }

.update-stale { color: var(--color-textMuted); }

.update-error {
  font-size: var(--text-label-size);
  color: var(--color-danger, #c0392b);
  background: var(--color-dangerLight, rgba(192, 57, 43, 0.08));
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-xs);
}

.update-note {
  background: var(--color-bgSubtle);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  padding: var(--space-3) var(--space-4);
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.update-note--warning {
  border-color: var(--color-warning);
  background: var(--color-warningLight, rgba(224, 162, 26, 0.1));
}

.note-heading { display: flex; align-items: center; gap: var(--space-2); color: var(--color-textPrimary); }
.note-actions { display: flex; gap: var(--space-2); }

.command {
  margin: 0;
  padding: var(--space-3);
  border-radius: var(--radius-xs);
  background: var(--color-bgElevated);
  border: 1px solid var(--color-border);
  color: var(--color-textSecondary);
  font-family: var(--font-mono, monospace);
  font-size: var(--text-micro-size);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.section-label {
  font-size: var(--text-micro-size);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--color-textMuted);
  margin-bottom: var(--space-2);
}

.update-history {
  border-top: 1px solid var(--color-border);
  padding-top: var(--space-3);
}

.release-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  padding: var(--space-2) 0;
}

.release-row + .release-row { border-top: 1px solid var(--color-border); }
.release-main { display: flex; align-items: center; gap: var(--space-2); flex-wrap: wrap; min-width: 0; }
.release-version { font-size: var(--text-label-size); color: var(--color-textPrimary); }
.release-date { font-size: var(--text-micro-size); color: var(--color-textMuted); }
.release-actions { display: flex; align-items: center; gap: var(--space-2); flex-shrink: 0; }

.release-link {
  font-size: var(--text-micro-size);
  color: var(--color-textMuted);
  text-decoration: none;
  white-space: nowrap;
}
.release-link:hover { color: var(--color-primary); }

.auto-update {
  border-top: 1px solid var(--color-border);
  padding-top: var(--space-3);
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.auto-row { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); }
.auto-window { display: flex; align-items: center; gap: var(--space-3); flex-wrap: wrap; }
.time-field { display: flex; align-items: center; gap: var(--space-2); font-size: var(--text-label-size); color: var(--color-textMuted); }
.time-field select {
  padding: var(--space-1) var(--space-2);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-xs);
  background: var(--color-bgSubtle);
  color: var(--color-textPrimary);
  font-family: var(--font-family);
  font-size: var(--text-label-size);
  color-scheme: light dark;
}
.auto-message { margin-top: calc(-1 * var(--space-1)); }

.confirm-box {
  display: flex;
  align-items: flex-start;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
  border: 1px solid var(--color-primary);
  border-radius: var(--radius-md);
  background: var(--color-accent-lighter);
  flex-wrap: wrap;
}
.confirm-icon { color: var(--color-primary); flex-shrink: 0; margin-top: 2px; }
.confirm-copy { flex: 1; min-width: 200px; }
.confirm-title { font-size: var(--text-body-size); font-weight: var(--font-weight-medium); color: var(--color-textPrimary); }
.confirm-actions { display: flex; gap: var(--space-2); align-items: center; }

.job-box {
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  padding: var(--space-3) var(--space-4);
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  background: var(--color-bgSubtle);
}
.job-box--success { border-color: var(--color-success); }
.job-box--warning { border-color: var(--color-warning); }
.job-box--danger { border-color: var(--color-danger, #c0392b); }
.job-head { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); color: var(--color-textPrimary); }
.job-percent { font-size: var(--text-label-size); color: var(--color-textMuted); }
.job-message { margin: 0; }
.job-error { color: var(--color-danger, #c0392b); }
.job-actions { display: flex; gap: var(--space-2); }

.progress-track {
  height: 6px;
  border-radius: var(--radius-full);
  background: var(--color-bgElevated);
  overflow: hidden;
}
.progress-fill {
  height: 100%;
  border-radius: inherit;
  background: var(--color-primary);
  transition: width 300ms ease;
}

.spinning { animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

.row-title { font-size: var(--text-body-size); font-weight: var(--font-weight-medium); color: var(--color-textPrimary); }

@media (max-width: 560px) {
  .latest-box,
  .auto-row,
  .release-row {
    align-items: flex-start;
    flex-direction: column;
  }
  .release-actions { width: 100%; justify-content: flex-end; }
}
</style>
