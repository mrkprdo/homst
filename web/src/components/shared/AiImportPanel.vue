<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue"
import { PhCheck, PhImage, PhSparkle, PhWarning, PhX } from "@phosphor-icons/vue"
import { aiApi, parseStream, type AiDraft, type AiStatus } from "@/api/ai"
import { calendarApi } from "@/api/calendar"
import { useEvents } from "@/composables/useEvents"
import UiButton from "@/components/ui/UiButton.vue"

const emit = defineEmits<{ done: [count: number] }>()

const { ensureDefaultCalendar, upsertEvent } = useEvents()

const status = ref<AiStatus | null>(null)
const statusError = ref("")
const text = ref("")
const imageDataUrl = ref<string | null>(null)
const imageName = ref("")
const fileInput = ref<HTMLInputElement | null>(null)
const parsing = ref(false)
const applying = ref(false)
const error = ref("")
const drafts = ref<AiDraft[]>([])
const selected = ref<boolean[]>([])
const addedDrafts = ref<AiDraft[]>([])
const outcome = ref<"success" | "partial" | "failed" | null>(null)
const skipped = ref(0)
const failed = ref(0)
const parsed = ref(false)
const dragging = ref(false)
const streamContent = ref("")
const streamReasoning = ref("")
const rawResponse = ref("")
const modelReasoning = ref("")
const streamBox = ref<HTMLElement | null>(null)

const hasInput = computed(() => text.value.trim().length > 0 || !!imageDataUrl.value)
const selectedCount = computed(() => selected.value.filter(Boolean).length)
const configured = computed(() => status.value?.configured === true)

const outcomeMessage = computed(() => {
  const count = addedDrafts.value.length
  if (outcome.value === "failed") {
    return "No events were added. Check the message and try again."
  }
  if (outcome.value === "partial") {
    return `Some events were added. ${failed.value} could not be saved.`
  }
  return `Added ${count} event${count === 1 ? "" : "s"} to your calendar.`
})

const RECUR_LABELS: Record<string, string> = {
  daily: "daily",
  weekly: "weekly",
  biweekly: "every 2 weeks",
  monthly: "monthly",
  yearly: "yearly",
}

onMounted(async () => {
  try {
    status.value = await aiApi.status()
  } catch {
    statusError.value = "Could not check Smart import settings."
  }
})

function formatWhen(draft: AiDraft): string {
  const date = new Date(draft.startAt)
  if (Number.isNaN(date.getTime())) return "Date unknown"
  if (draft.allDay) {
    return date.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })
  }
  const day = date.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })
  const time = date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
  const end = draft.endAt ? new Date(draft.endAt) : null
  const endTime = end && !Number.isNaN(end.getTime())
    ? end.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : ""
  return endTime ? `${day} · ${time} – ${endTime}` : `${day} · ${time}`
}

function repeatLabel(draft: AiDraft): string {
  if (!draft.recurrence?.freq) return ""
  const label = RECUR_LABELS[draft.recurrence.freq] ?? draft.recurrence.freq
  if (draft.recurrence.count) return `Repeats ${label} (${draft.recurrence.count}×)`
  if (draft.recurrence.until) {
    const until = new Date(draft.recurrence.until)
    if (!Number.isNaN(until.getTime())) {
      return `Repeats ${label} until ${until.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })}`
    }
  }
  return `Repeats ${label}`
}

function resetResults() {
  drafts.value = []
  selected.value = []
  addedDrafts.value = []
  outcome.value = null
  skipped.value = 0
  failed.value = 0
  parsed.value = false
  error.value = ""
  streamContent.value = ""
  streamReasoning.value = ""
  rawResponse.value = ""
  modelReasoning.value = ""
}

watch([streamReasoning, streamContent], async () => {
  await nextTick()
  if (streamBox.value) streamBox.value.scrollTop = streamBox.value.scrollHeight
})

function readFile(file: File) {
  if (!file.type.startsWith("image/")) {
    error.value = "Attach a PNG, JPEG, WebP or GIF image."
    return
  }
  if (file.size > 8 * 1024 * 1024) {
    error.value = "That image is larger than 8 MB."
    return
  }
  const reader = new FileReader()
  reader.onload = () => {
    imageDataUrl.value = typeof reader.result === "string" ? reader.result : null
    imageName.value = file.name || "Screenshot"
    resetResults()
  }
  reader.onerror = () => { error.value = "Could not read that image." }
  reader.readAsDataURL(file)
}

function onFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (file) readFile(file)
  input.value = ""
}

function onDrop(event: DragEvent) {
  dragging.value = false
  const file = event.dataTransfer?.files?.[0]
  if (file) readFile(file)
}

function onPaste(event: ClipboardEvent) {
  const files = Array.from(event.clipboardData?.files ?? [])
  const image = files.find(file => file.type.startsWith("image/"))
  if (image) {
    event.preventDefault()
    readFile(image)
  }
}

function clearImage() {
  imageDataUrl.value = null
  imageName.value = ""
}

/** The raw trigger is stored on every event so an import stays auditable. */
function buildSourceMessage(): string {
  const message = text.value.trim()
  const screenshot = imageName.value ? `[Screenshot: ${imageName.value}]` : ""
  const source = [message, screenshot].filter(Boolean).join("\n\n") || "Imported with Smart import."
  return source.length > 20_000 ? `${source.slice(0, 19_990)}…` : source
}

async function parse() {
  if (!hasInput.value || parsing.value) return
  parsing.value = true
  error.value = ""
  resetResults()
  try {
    const result = await parseStream(
      {
        text: text.value,
        image: imageDataUrl.value,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      },
      {
        onReasoning: chunk => { streamReasoning.value += chunk },
        onContent: chunk => { streamContent.value += chunk },
      },
    )
    drafts.value = result.events
    selected.value = result.events.map(() => true)
    skipped.value = result.skipped
    rawResponse.value = result.response || streamContent.value
    modelReasoning.value = result.reasoning ?? streamReasoning.value
    parsed.value = true
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Could not read that message."
  } finally {
    parsing.value = false
  }
}

function toggle(index: number) {
  selected.value[index] = !selected.value[index]
}

function toggleAll() {
  const next = selectedCount.value !== drafts.value.length
  selected.value = drafts.value.map(() => next)
}

async function applySelected() {
  if (applying.value || selectedCount.value === 0) return
  applying.value = true
  error.value = ""
  failed.value = 0
  outcome.value = null
  const saved: AiDraft[] = []
  const failedDrafts: AiDraft[] = []
  const sourceMessage = buildSourceMessage()
  try {
    const calendarId = await ensureDefaultCalendar()
    for (const [index, draft] of drafts.value.entries()) {
      if (!selected.value[index]) continue
      try {
        const event = await calendarApi.createEvent({
          calendar_id: calendarId,
          title: draft.title,
          description: draft.description,
          source_message: sourceMessage,
          start_at: draft.startAt,
          end_at: draft.endAt ?? undefined,
          all_day: draft.allDay,
          recurrence: draft.recurrence,
          reminder_minutes: draft.reminderMinutes,
          assignee_id: draft.assigneeId,
        })
        upsertEvent(event)
        saved.push(draft)
      } catch {
        failedDrafts.push(draft)
      }
    }
  } finally {
    applying.value = false
  }

  failed.value = failedDrafts.length
  if (saved.length > 0) {
    addedDrafts.value = [...addedDrafts.value, ...saved]
  }
  if (failedDrafts.length === 0) {
    outcome.value = "success"
    drafts.value = []
    selected.value = []
  } else if (saved.length > 0) {
    outcome.value = "partial"
    drafts.value = failedDrafts
    selected.value = failedDrafts.map(() => true)
  } else {
    outcome.value = "failed"
    selected.value = drafts.value.map(() => true)
  }
}

/** Close the add panel once the household has seen what was added. */
function finish() {
  emit("done", addedDrafts.value.length)
}

function startOver() {
  text.value = ""
  clearImage()
  resetResults()
}
</script>

<template>
  <div class="ai-import" @paste="onPaste">
    <div v-if="statusError" class="ai-notice" role="alert">{{ statusError }}</div>

    <div v-else-if="status && !configured" class="ai-setup" role="status">
      <PhSparkle :size="22" weight="duotone" class="ai-setup-icon" />
      <div>
        <p class="ai-setup-title">Smart import is off</p>
        <p class="ai-setup-copy">
          Add an OpenCode API key in Settings → Smart import, then paste an email
          or screenshot here.
        </p>
      </div>
    </div>

    <template v-else>
      <p class="ai-intro">
        Paste the email, or drop a screenshot. HOMST turns it into events you can
        review before adding them. The message is saved with every event it creates.
      </p>

      <label class="ai-label" for="ai-context">Email or message</label>
      <textarea
        id="ai-context"
        v-model="text"
        class="ai-textarea"
        rows="5"
        placeholder="Paste the email or message here…"
        :disabled="parsing || applying"
        @input="resetResults"
      />

      <div
        class="ai-drop"
        :class="{ 'ai-drop--active': dragging, 'ai-drop--filled': !!imageDataUrl }"
        @dragover.prevent="dragging = true"
        @dragleave.prevent="dragging = false"
        @drop.prevent="onDrop"
      >
        <template v-if="imageDataUrl">
          <img :src="imageDataUrl" :alt="imageName || 'Attached screenshot'" class="ai-thumb" />
          <div class="ai-drop-copy">
            <span class="ai-drop-title">{{ imageName || "Screenshot attached" }}</span>
            <span class="ai-drop-hint">It will be read on the server, then discarded.</span>
          </div>
          <button type="button" class="ai-clear" aria-label="Remove image" @click="clearImage">
            <PhX :size="16" />
          </button>
        </template>
        <template v-else>
          <PhImage :size="22" class="ai-drop-icon" />
          <div class="ai-drop-copy">
            <span class="ai-drop-title">Add a screenshot</span>
            <span class="ai-drop-hint">Drop it here, paste it, or choose a file (max 8 MB)</span>
          </div>
          <button type="button" class="ai-browse" :disabled="parsing || applying" @click="fileInput?.click()">
            Choose
          </button>
        </template>
        <input
          ref="fileInput"
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          class="ai-file"
          @change="onFileChange"
        />
      </div>

      <p v-if="error" class="ai-error" role="alert">{{ error }}</p>

      <div class="ai-actions">
        <UiButton
          variant="ghost"
          :disabled="parsing || applying || !hasInput"
          @click="startOver"
        >
          Clear
        </UiButton>
        <UiButton :disabled="parsing || applying || !hasInput" @click="parse">
          <PhSparkle :size="16" weight="fill" />
          {{ parsing ? "Reading…" : "Find events" }}
        </UiButton>
      </div>

      <details
        v-if="streamReasoning || streamContent || modelReasoning || rawResponse"
        class="ai-stream"
        :open="parsing"
      >
        <summary class="ai-stream-summary">
          {{ parsing ? "Model is working…" : "Model response" }}
        </summary>
        <div ref="streamBox" class="ai-stream-body">
          <template v-if="streamReasoning || modelReasoning">
            <p class="ai-stream-label">Reasoning</p>
            <pre class="ai-stream-text">{{ streamReasoning || modelReasoning }}</pre>
          </template>
          <template v-if="streamContent || rawResponse">
            <p class="ai-stream-label">Output</p>
            <pre class="ai-stream-text">{{ streamContent || rawResponse }}</pre>
          </template>
        </div>
      </details>

      <div
        v-if="outcome"
        class="ai-outcome"
        :class="`ai-outcome--${outcome}`"
        role="status"
      >
        <PhCheck v-if="outcome === 'success'" :size="18" weight="bold" class="ai-outcome-icon" />
        <PhWarning v-else :size="18" weight="fill" class="ai-outcome-icon" />
        <span>{{ outcomeMessage }}</span>
      </div>

      <div v-if="addedDrafts.length > 0" class="ai-added">
        <p class="ai-added-title">Recently added</p>
        <ul class="ai-added-list">
          <li
            v-for="(draft, index) in addedDrafts"
            :key="`${draft.title}-${index}`"
            class="ai-added-item"
          >
            <PhCheck :size="16" weight="bold" class="ai-added-icon" />
            <span class="ai-added-copy">
              <span class="ai-added-name">{{ draft.title }}</span>
              <span class="ai-added-when">{{ formatWhen(draft) }}</span>
              <span v-if="repeatLabel(draft)" class="ai-added-repeat">{{ repeatLabel(draft) }}</span>
            </span>
          </li>
        </ul>
        <div class="ai-actions">
          <UiButton @click="finish">Done</UiButton>
        </div>
      </div>

      <div v-if="drafts.length > 0" class="ai-results">
        <div class="ai-results-head">
          <p class="ai-results-title">
            {{ drafts.length }} {{ drafts.length === 1 ? "event" : "events" }} found
          </p>
          <button type="button" class="ai-select-all" @click="toggleAll">
            {{ selectedCount === drafts.length ? "Select none" : "Select all" }}
          </button>
        </div>

        <ul class="ai-list">
          <li v-for="(draft, index) in drafts" :key="`${draft.title}-${index}`" class="ai-item">
            <label class="ai-item-main">
              <input
                type="checkbox"
                class="ai-checkbox"
                :checked="selected[index]"
                @change="toggle(index)"
              />
              <span class="ai-item-copy">
                <span class="ai-item-title">{{ draft.title }}</span>
                <span class="ai-item-when">{{ formatWhen(draft) }}</span>
                <span v-if="repeatLabel(draft)" class="ai-item-repeat">{{ repeatLabel(draft) }}</span>
                <span v-if="draft.confidence < 0.6" class="ai-item-warn">Check the details</span>
              </span>
            </label>
          </li>
        </ul>

        <p v-if="skipped > 0" class="ai-skipped">
          {{ skipped }} item{{ skipped === 1 ? "" : "s" }} skipped because no date was found.
        </p>
        <p v-if="failed > 0" class="ai-error">{{ failed }} event(s) could not be saved.</p>

        <div class="ai-actions">
          <UiButton
            :disabled="applying || selectedCount === 0"
            @click="applySelected"
          >
            {{ applying ? "Adding…" : `Add ${selectedCount} ${selectedCount === 1 ? "event" : "events"}` }}
          </UiButton>
        </div>
      </div>

      <div
        v-else-if="parsed && !parsing && !error && addedDrafts.length === 0"
        class="ai-empty"
        role="status"
      >
        <PhSparkle :size="20" weight="duotone" class="ai-empty-icon" />
        <div>
          <p class="ai-empty-title">No events found</p>
          <p class="ai-empty-copy">
            The message did not contain an explicit date or time.
            <template v-if="skipped > 0">
              {{ skipped }} item{{ skipped === 1 ? "" : "s" }} had no date.
            </template>
          </p>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.ai-import {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.ai-intro,
.ai-drop-hint,
.ai-setup-copy,
.ai-skipped {
  margin: 0;
  color: var(--color-textMuted);
  font-size: var(--text-label-size);
  line-height: 1.5;
}

/* ── Live model stream ── */
.ai-stream {
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-bgSubtle);
  padding: var(--space-2) var(--space-3);
}

.ai-stream-summary {
  cursor: pointer;
  font-size: var(--text-label-size);
  font-weight: var(--font-weight-medium);
  color: var(--color-textMuted);
}

.ai-stream-body {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  margin-top: var(--space-2);
  max-height: 200px;
  overflow-y: auto;
}

.ai-stream-label {
  margin: 0;
  font-size: var(--text-micro-size);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--color-textMuted);
}

.ai-stream-text {
  margin: 0;
  font-family: var(--font-mono, monospace);
  font-size: var(--text-label-size);
  line-height: 1.5;
  color: var(--color-textSecondary);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

/* ── Apply outcome + recently added ── */
.ai-outcome {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
  padding: var(--space-3) var(--space-4);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  font-size: var(--text-label-size);
  line-height: 1.5;
  font-weight: var(--font-weight-medium);
}

.ai-outcome--success {
  color: var(--color-success);
  border-color: color-mix(in srgb, var(--color-success) 45%, transparent);
  background: color-mix(in srgb, var(--color-success) 12%, transparent);
}

.ai-outcome--partial {
  color: var(--color-warning);
  border-color: color-mix(in srgb, var(--color-warning) 45%, transparent);
  background: color-mix(in srgb, var(--color-warning) 12%, transparent);
}

.ai-outcome--failed {
  color: var(--color-danger);
  border-color: color-mix(in srgb, var(--color-danger) 45%, transparent);
  background: color-mix(in srgb, var(--color-danger) 12%, transparent);
}

.ai-outcome-icon {
  flex-shrink: 0;
  margin-top: 1px;
}

.ai-added {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding-top: var(--space-3);
  border-top: 1px solid var(--color-border);
}

.ai-added-title {
  margin: 0;
  font-size: var(--text-label-size);
  font-weight: var(--font-weight-medium);
  color: var(--color-textSecondary);
}

.ai-added-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  margin: 0;
  padding: 0;
  list-style: none;
}

.ai-added-item {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-bgSurface);
}

.ai-added-icon {
  flex-shrink: 0;
  margin-top: 2px;
  color: var(--color-success);
}

.ai-added-copy {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}

.ai-added-name {
  font-size: var(--text-body-size);
  font-weight: var(--font-weight-medium);
  color: var(--color-textPrimary);
}

.ai-added-when,
.ai-added-repeat {
  font-size: var(--text-label-size);
  color: var(--color-textMuted);
  font-variant-numeric: tabular-nums;
}

.ai-added-repeat {
  color: var(--color-accent-darker);
}

/* ── Empty result ── */
.ai-empty {
  display: flex;
  gap: var(--space-3);
  padding: var(--space-4);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-bgSubtle);
}

.ai-empty-icon {
  flex-shrink: 0;
  color: var(--color-textMuted);
}

.ai-empty-title {
  margin: 0 0 2px;
  font-size: var(--text-body-size);
  font-weight: var(--font-weight-medium);
  color: var(--color-textPrimary);
}

.ai-empty-copy {
  margin: 0;
  font-size: var(--text-label-size);
  line-height: 1.5;
  color: var(--color-textMuted);
}

.ai-label {
  font-size: var(--text-label-size);
  font-weight: var(--font-weight-medium);
  color: var(--color-textMuted);
}

.ai-textarea {
  width: 100%;
  min-height: 120px;
  padding: var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-bgSurface);
  color: var(--color-textPrimary);
  font-family: var(--font-family);
  font-size: var(--text-body-size);
  line-height: 1.5;
  resize: vertical;
}

.ai-textarea:focus-visible {
  outline: 2px solid var(--color-accent-darker);
  outline-offset: 1px;
}

.ai-drop {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3);
  border: 1px dashed var(--color-borderStrong);
  border-radius: var(--radius-sm);
  background: var(--color-bgSubtle);
  transition: border-color var(--duration-fast), background var(--duration-fast);
}

.ai-drop--active {
  border-color: var(--color-accent-darker);
  background: var(--color-accent-lighter);
}

.ai-drop-icon {
  flex-shrink: 0;
  color: var(--color-textMuted);
}

.ai-drop-copy {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  flex: 1;
}

.ai-drop-title {
  font-size: var(--text-label-size);
  font-weight: var(--font-weight-medium);
  color: var(--color-textSecondary);
}

.ai-thumb {
  width: 54px;
  height: 54px;
  object-fit: cover;
  border-radius: var(--radius-xs);
  flex-shrink: 0;
}

.ai-file {
  display: none;
}

.ai-browse,
.ai-clear,
.ai-select-all {
  flex-shrink: 0;
  border: none;
  background: transparent;
  color: var(--color-accent-darker);
  font-family: var(--font-family);
  font-size: var(--text-label-size);
  font-weight: var(--font-weight-medium);
  cursor: pointer;
}

.ai-clear {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: var(--radius-full);
  color: var(--color-textMuted);
}

.ai-clear:hover {
  background: var(--color-bgSurface);
}

.ai-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-3);
}

.ai-error {
  margin: 0;
  color: var(--color-danger);
  font-size: var(--text-label-size);
}

.ai-results {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding-top: var(--space-3);
  border-top: 1px solid var(--color-border);
}

.ai-results-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
}

.ai-results-title {
  margin: 0;
  font-size: var(--text-label-size);
  font-weight: var(--font-weight-medium);
  color: var(--color-textSecondary);
}

.ai-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  margin: 0;
  padding: 0;
  list-style: none;
}

.ai-item {
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-bgSurface);
}

.ai-item-main {
  display: flex;
  align-items: flex-start;
  gap: var(--space-3);
  padding: var(--space-3);
  cursor: pointer;
}

.ai-checkbox {
  width: 18px;
  height: 18px;
  margin-top: 2px;
  accent-color: var(--color-accent-darker);
  flex-shrink: 0;
}

.ai-item-copy {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.ai-item-title {
  font-size: var(--text-body-size);
  font-weight: var(--font-weight-medium);
  color: var(--color-textPrimary);
}

.ai-item-when,
.ai-item-repeat,
.ai-item-warn {
  font-size: var(--text-label-size);
  color: var(--color-textMuted);
  font-variant-numeric: tabular-nums;
}

.ai-item-repeat {
  color: var(--color-accent-darker);
}

.ai-item-warn {
  color: var(--color-warning, #a46a00);
}

.ai-setup {
  display: flex;
  gap: var(--space-3);
  padding: var(--space-4);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-bgSubtle);
}

.ai-setup-icon {
  flex-shrink: 0;
  color: var(--color-accent-darker);
}

.ai-setup-title {
  margin: 0 0 2px;
  font-size: var(--text-body-size);
  font-weight: var(--font-weight-medium);
  color: var(--color-textPrimary);
}

.ai-notice {
  padding: var(--space-3);
  border-radius: var(--radius-sm);
  background: var(--color-bgSubtle);
  color: var(--color-danger);
  font-size: var(--text-label-size);
}
</style>
