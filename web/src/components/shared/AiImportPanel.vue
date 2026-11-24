<script setup lang="ts">
import { computed, nextTick, onMounted, ref, useId, watch } from "vue"
import {
  PhChatText,
  PhCheck,
  PhImage,
  PhSparkle,
  PhWarning,
  PhX,
} from "@phosphor-icons/vue"
import {
  aiApi,
  parseStream,
  type AiClarification,
  type AiConflict,
  type AiDraft,
  type AiQuestion,
  type AiStatus,
} from "@/api/ai"
import { calendarApi } from "@/api/calendar"
import { useEvents } from "@/composables/useEvents"
import UiButton from "@/components/ui/UiButton.vue"
import UiInput from "@/components/ui/UiInput.vue"
import UiSelect from "@/components/ui/UiSelect.vue"
import UiTextarea from "@/components/ui/UiTextarea.vue"
import { reminderLabel } from "@/utils/reminders"

const props = defineProps<{ memberNames?: Record<string, string> }>()
const emit = defineEmits<{ done: [count: number]; manual: [] }>()

const { ensureDefaultCalendar, upsertEvent } = useEvents()

const uid = useId()
const rootEl = ref<HTMLElement | null>(null)
const resultsHeading = ref<HTMLElement | null>(null)
const streamBox = ref<HTMLElement | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)

const status = ref<AiStatus | null>(null)
const statusLoading = ref(true)
const statusError = ref("")
const text = ref("")
const imageDataUrl = ref<string | null>(null)
const imageName = ref("")
const parsing = ref(false)
const applying = ref(false)
const error = ref("")
const drafts = ref<AiDraft[]>([])
const selected = ref<boolean[]>([])
const addedDrafts = ref<AiDraft[]>([])
const outcome = ref<"success" | "partial" | "failed" | null>(null)
const failed = ref(0)
const skipped = ref(0)
const parsed = ref(false)
const dragging = ref(false)
const streamContent = ref("")
const streamReasoning = ref("")
const warnings = ref<string[]>([])
const questions = ref<AiQuestion[]>([])
const conflicts = ref<AiConflict[]>([])
const answers = ref<Record<string, string>>({})
const clarifications = ref<AiClarification[]>([])
const questionRounds = ref(0)

const MAX_QUESTION_ROUNDS = 3

type Stage = "input" | "reading" | "questions" | "review" | "empty" | "done"

const stage = computed<Stage>(() => {
  if (parsing.value) return "reading"
  if (questions.value.length > 0) return "questions"
  if (outcome.value === "success" && drafts.value.length === 0) return "done"
  if (drafts.value.length > 0) return "review"
  if (parsed.value) return "empty"
  return "input"
})

const hasMessage = computed(() => text.value.trim().length > 0)
const hasSource = computed(() => hasMessage.value || !!imageDataUrl.value)
const selectedCount = computed(() => selected.value.filter(Boolean).length)
const configured = computed(() => status.value?.configured === true)
const memberOptions = computed(() =>
  Object.entries(props.memberNames ?? {})
    .filter(([, name]) => !!name)
    .map(([id, name]) => ({ id, name }))
    .sort((first, second) => first.name.localeCompare(second.name)),
)
const canAnswerQuestions = computed(
  () =>
    questions.value.length > 0 &&
    questions.value.every(question => !!answers.value[question.id]?.trim()),
)
const blockingConflicts = computed(() =>
  conflicts.value.filter(conflict => selected.value[conflict.draftIndex] !== false),
)

const sourceTitle = computed(() => {
  if (text.value.trim() && imageDataUrl.value) return "Message and image"
  if (imageDataUrl.value) return imageName.value || "Image"
  return "Message"
})

const sourcePreview = computed(() => {
  const firstLine = text.value.trim().split(/\r?\n/).find(line => line.trim())?.trim() ?? ""
  if (!firstLine) return imageDataUrl.value ? "Image attached" : ""
  return firstLine.length > 86 ? `${firstLine.slice(0, 85).trimEnd()}…` : firstLine
})

const reviewNotes = computed(() => {
  const notes = [...warnings.value]
  if (skipped.value > 0) {
    const label = skipped.value === 1 ? "entry" : "entries"
    notes.push(`${skipped.value} ${label} couldn't be turned into an event.`)
  }
  return notes
})

const outcomeMessage = computed(() => {
  const count = addedDrafts.value.length
  if (outcome.value === "failed") return "No events were added."
  if (outcome.value === "partial") {
    return `Added ${count} event${count === 1 ? "" : "s"}. ${failed.value} couldn't be saved.`
  }
  return `Added ${count} event${count === 1 ? "" : "s"} to your calendar.`
})

const outcomeHint = computed(() => {
  if (outcome.value === "failed") {
    return "The server rejected the request, so nothing was saved. Try again in a moment."
  }
  return "The events below still need saving. Try again when you're ready."
})

const RECUR_LABELS: Record<string, string> = {
  daily: "daily",
  weekly: "weekly",
  biweekly: "every 2 weeks",
  monthly: "monthly",
  yearly: "yearly",
}

onMounted(() => {
  void loadStatus()
})

async function loadStatus() {
  statusLoading.value = true
  statusError.value = ""
  try {
    status.value = await aiApi.status()
  } catch {
    statusError.value = "The server didn't answer. Check the connection and try again."
  } finally {
    statusLoading.value = false
  }
}

function formatWhen(draft: AiDraft): string {
  const date = new Date(draft.startAt)
  if (Number.isNaN(date.getTime())) return "Date unknown"
  const day = date.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })
  const end = draft.endAt ? new Date(draft.endAt) : null
  const validEnd = end && !Number.isNaN(end.getTime()) ? end : null
  const endDay = validEnd
    ? validEnd.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })
    : ""
  const spansDays = !!validEnd && dateInputValue(validEnd.toISOString()) !== dateInputValue(draft.startAt)

  if (draft.allDay) {
    return spansDays ? `${day} – ${endDay} · All day` : `${day} · All day`
  }

  const time = date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
  const endTime = validEnd
    ? validEnd.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : ""
  if (!endTime) return `${day} · ${time}`
  return spansDays
    ? `${day}, ${time} – ${endDay}, ${endTime}`
    : `${day} · ${time} – ${endTime}`
}

function repeatLabel(draft: AiDraft): string {
  if (!draft.recurrence?.freq) return ""
  const label = RECUR_LABELS[draft.recurrence.freq] ?? draft.recurrence.freq
  if (draft.recurrence.count) {
    return `Repeats ${label} · ${draft.recurrence.count} ${draft.recurrence.count === 1 ? "time" : "times"}`
  }
  if (draft.recurrence.until) {
    const until = new Date(draft.recurrence.until)
    if (!Number.isNaN(until.getTime())) {
      return `Repeats ${label} until ${until.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })}`
    }
  }
  return `Repeats ${label}`
}

function draftMeta(draft: AiDraft): string {
  const bits: string[] = []
  const reminder = reminderLabel(draft.reminderMinutes)
  if (reminder) bits.push(reminder)
  const assignee = draft.assigneeId ? props.memberNames?.[draft.assigneeId] : ""
  if (assignee) bits.push(`For ${assignee}`)
  else if (memberOptions.value.length > 0) bits.push("Not assigned")
  return bits.join(" · ")
}

function shortDescription(draft: AiDraft): string {
  const words = draft.description.trim().replace(/\s+/g, " ")
  if (!words) return ""
  return words.length > 120 ? `${words.slice(0, 119).trimEnd()}…` : words
}

interface EditBuffer {
  title: string
  date: string
  endDate: string
  start: string
  end: string
  allDay: boolean
  assigneeId: string
}

const editingIndex = ref<number | null>(null)
const editBuffer = ref<EditBuffer | null>(null)

function resetResults(keepClarifications = false) {
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
  warnings.value = []
  questions.value = []
  conflicts.value = []
  answers.value = {}
  editingIndex.value = null
  editBuffer.value = null
  streamBox.value = null
  if (!keepClarifications) {
    clarifications.value = []
    questionRounds.value = 0
  }
}

watch([streamReasoning, streamContent], async () => {
  await nextTick()
  if (streamBox.value) streamBox.value.scrollTop = streamBox.value.scrollHeight
})

/** Each stage owns the panel, so the reader never scrolls past the form to find results. */
watch(stage, async (next) => {
  if (rootEl.value) {
    const scroller = rootEl.value.closest<HTMLElement>(".drawer-content, .mqa-body")
    if (scroller) scroller.scrollTop = 0
  }
  if (next === "questions" || next === "review" || next === "empty" || next === "done") {
    await nextTick()
    resultsHeading.value?.focus({ preventScroll: true })
  }
})

function onTextInput() {
  resetResults()
}

function readFile(file: File) {
  error.value = ""
  if (!file.type.startsWith("image/")) {
    error.value = "Choose a PNG, JPEG, WebP or GIF image."
    return
  }
  if (file.size > 8 * 1024 * 1024) {
    error.value = "That image is larger than 8 MB."
    return
  }
  const reader = new FileReader()
  reader.onload = () => {
    imageDataUrl.value = typeof reader.result === "string" ? reader.result : null
    imageName.value = file.name || "Image"
    resetResults()
    nextTick(() => rootEl.value?.querySelector<HTMLTextAreaElement>(".ai-message")?.focus())
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
  resetResults()
}

/** The raw trigger is stored on every event so an import stays auditable. */
function buildSourceMessage(): string {
  const message = text.value.trim()
  const image = imageName.value ? `[Image: ${imageName.value}]` : ""
  const source = [message, image].filter(Boolean).join("\n\n") || "Imported with Smart import."
  return source.length > 20_000 ? `${source.slice(0, 19_990)}…` : source
}

async function parse() {
  if (!hasMessage.value || parsing.value) return
  parsing.value = true
  error.value = ""
  resetResults(true)
  try {
    const result = await parseStream(
      {
        text: text.value,
        image: imageDataUrl.value,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        clarifications: clarifications.value,
      },
      {
        onReasoning: chunk => { streamReasoning.value += chunk },
        onContent: chunk => { streamContent.value += chunk },
      },
    )
    drafts.value = result.events
    selected.value = result.events.map(() => true)
    skipped.value = result.skipped
    warnings.value = result.warnings
    questions.value = result.questions
    conflicts.value = result.conflicts
    answers.value = {}
    parsed.value = true
    if (questions.value.length > 0 && questionRounds.value >= MAX_QUESTION_ROUNDS) {
      for (const question of questions.value) {
        warnings.value.push(`Still needs an answer: ${question.question}`)
      }
      questions.value = []
    }
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Could not read that message."
  } finally {
    parsing.value = false
  }
}

function chooseAnswer(question: AiQuestion, option: string) {
  answers.value[question.id] = option
}

async function answerQuestions() {
  if (!canAnswerQuestions.value || parsing.value) return
  for (const question of questions.value) {
    const answer = answers.value[question.id]?.trim()
    if (answer) clarifications.value.push({ question: question.question, answer })
  }
  questionRounds.value += 1
  questions.value = []
  await parse()
}

function skipQuestions() {
  for (const question of questions.value) {
    warnings.value.push(`Still unclear: ${question.question}`)
  }
  questions.value = []
}

function dismissConflict(id: string) {
  conflicts.value = conflicts.value.filter(conflict => conflict.id !== id)
}

function editConflict(conflict: AiConflict) {
  dismissConflict(conflict.id)
  openEditor(conflict.draftIndex)
}

function toggle(index: number) {
  selected.value[index] = !selected.value[index]
}

function toggleAll() {
  const next = selectedCount.value !== drafts.value.length
  selected.value = drafts.value.map(() => next)
}

async function applySelected() {
  if (
    applying.value ||
    selectedCount.value === 0 ||
    editingIndex.value !== null ||
    blockingConflicts.value.length > 0
  ) return
  applying.value = true
  error.value = ""
  failed.value = 0
  outcome.value = null
  conflicts.value = []
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
  } else {
    outcome.value = addedDrafts.value.length > 0 ? "partial" : "failed"
    drafts.value = failedDrafts
    selected.value = failedDrafts.map(() => true)
  }
  editingIndex.value = null
  editBuffer.value = null
}

/** Close the add panel once the household has seen what was added. */
function finish() {
  emit("done", addedDrafts.value.length)
}

function startOver() {
  text.value = ""
  imageDataUrl.value = null
  imageName.value = ""
  resetResults()
  nextTick(() => rootEl.value?.querySelector<HTMLTextAreaElement>(".ai-message")?.focus())
}

function editSource() {
  resetResults()
  nextTick(() => rootEl.value?.querySelector<HTMLTextAreaElement>(".ai-message")?.focus())
}

// ── Inline draft editing ──────────────────────────────────────────────────
function pad(value: number): string {
  return String(value).padStart(2, "0")
}

function dateInputValue(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ""
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function timeInputValue(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ""
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function addMinutesToTime(time: string, minutes: number): string {
  const [hours, mins] = time.split(":").map(Number)
  if (Number.isNaN(hours) || Number.isNaN(mins)) return ""
  const total = (hours * 60 + mins + minutes) % (24 * 60)
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`
}

// Keep the end time sensible while a person adjusts the start, matching the
// manual form. Cross-day events keep the end time they were given.
watch(
  () => editBuffer.value?.start,
  (value) => {
    const buffer = editBuffer.value
    if (!buffer || buffer.allDay || !value) return
    const sameDay = !buffer.endDate || buffer.endDate === buffer.date
    if (sameDay && (!buffer.end || buffer.end <= value)) {
      buffer.end = addMinutesToTime(value, 60)
    }
  },
)

const editError = computed(() => {
  const buffer = editBuffer.value
  if (!buffer) return ""
  if (!buffer.title.trim()) return "Add a title."
  if (!buffer.date) return "Choose a date."
  if (buffer.endDate && buffer.endDate < buffer.date) return "The end date can't be before the start date."
  if (!buffer.allDay) {
    if (!buffer.start) return "Add a start time."
    const sameDay = !buffer.endDate || buffer.endDate === buffer.date
    if (sameDay && buffer.end && buffer.end <= buffer.start) {
      return "The end time must be after the start time."
    }
  }
  return ""
})

function openEditor(index: number) {
  const draft = drafts.value[index]
  if (!draft) return
  if (editingIndex.value === index) {
    cancelEdit()
    return
  }
  const startDate = dateInputValue(draft.startAt)
  const endDate = draft.endAt ? dateInputValue(draft.endAt) : ""
  editingIndex.value = index
  editBuffer.value = {
    title: draft.title,
    date: startDate,
    endDate: endDate && endDate !== startDate ? endDate : "",
    start: draft.allDay ? "09:00" : timeInputValue(draft.startAt) || "09:00",
    end: draft.endAt ? timeInputValue(draft.endAt) : "",
    allDay: draft.allDay,
    assigneeId: draft.assigneeId ?? "",
  }
  nextTick(() => {
    const item = rootEl.value?.querySelector<HTMLElement>(".ai-item--editing")
    if (item && typeof item.scrollIntoView === "function") item.scrollIntoView({ block: "start" })
    rootEl.value?.querySelector<HTMLInputElement>(".ai-item--editing .ai-edit-title")
      ?.focus({ preventScroll: true })
  })
}

function cancelEdit() {
  const index = editingIndex.value
  editingIndex.value = null
  editBuffer.value = null
  if (index === null) return
  nextTick(() => {
    rootEl.value?.querySelectorAll<HTMLButtonElement>(".ai-item-edit")[index]?.focus()
  })
}

function saveEdit() {
  const index = editingIndex.value
  const buffer = editBuffer.value
  const draft = index === null ? null : drafts.value[index]
  if (index === null || !buffer || !draft || editError.value) return

  const start = new Date(`${buffer.date}T${buffer.allDay ? "00:00" : buffer.start}`)
  if (Number.isNaN(start.getTime())) return

  let end: Date | null = null
  if (buffer.allDay) {
    if (buffer.endDate && buffer.endDate > buffer.date) {
      end = new Date(`${buffer.endDate}T23:59:59`)
    }
  } else {
    const endDate = buffer.endDate || buffer.date
    const endTime = buffer.end || addMinutesToTime(buffer.start, 60)
    end = new Date(`${endDate}T${endTime}`)
    if (end <= start) end = new Date(start.getTime() + 60 * 60 * 1000)
  }

  draft.title = buffer.title.trim()
  draft.startAt = start.toISOString()
  draft.endAt = end ? end.toISOString() : null
  draft.allDay = buffer.allDay
  draft.assigneeId = buffer.assigneeId || null
  // A person checked this event, so the low-confidence flag no longer applies.
  draft.confidence = 1
  cancelEdit()
  nextTick(() => rootEl.value?.querySelector<HTMLElement>(".ai-add-bar .ui-btn")?.focus())
}
</script>

<template>
  <div ref="rootEl" class="ai-import" @paste="onPaste">
    <div v-if="statusLoading" class="ai-loading" role="status">
      <span class="ai-spinner" aria-hidden="true" />
      <span>Checking Smart import…</span>
    </div>

    <div v-else-if="statusError" class="ai-callout ai-callout--danger" role="alert">
      <PhWarning :size="18" weight="fill" class="ai-callout-icon" aria-hidden="true" />
      <div class="ai-callout-copy">
        <p class="ai-callout-title">Couldn't check Smart import</p>
        <p class="ai-callout-text">{{ statusError }}</p>
      </div>
      <UiButton size="sm" variant="ghost" @click="loadStatus">Try again</UiButton>
    </div>

    <div v-else-if="!configured" class="ai-setup" role="status">
      <PhSparkle :size="22" weight="duotone" class="ai-setup-icon" aria-hidden="true" />
      <div class="ai-setup-copy">
        <p class="ai-setup-title">Smart import is off</p>
        <p class="ai-setup-text">
          Add an OpenCode API key in Settings → Smart import to generate events
          from a message.
        </p>
      </div>
      <UiButton size="sm" variant="ghost" @click="loadStatus">Check again</UiButton>
    </div>

    <template v-else>
      <div v-if="stage !== 'input'" class="ai-source">
        <details>
          <summary class="ai-source-summary">
            <PhChatText :size="18" class="ai-source-icon" aria-hidden="true" />
            <span class="ai-source-copy">
              <span class="ai-source-title">{{ sourceTitle }}</span>
              <span class="ai-source-preview">{{ sourcePreview }}</span>
            </span>
            <span class="ai-source-open">View</span>
          </summary>
          <div class="ai-source-body">
            <pre v-if="text.trim()" class="ai-source-text">{{ text }}</pre>
            <img
              v-if="imageDataUrl"
              :src="imageDataUrl"
              :alt="imageName || 'Attached image'"
              class="ai-source-image"
            />
          </div>
        </details>
        <div v-if="stage === 'review' || stage === 'empty'" class="ai-source-actions">
          <button type="button" class="ai-source-edit" @click="editSource">Change message</button>
        </div>
      </div>

      <div :key="stage" class="ai-stage">
        <!-- ── 1. Enter the source ── -->
        <template v-if="stage === 'input'">
          <div class="ai-field">
            <div class="ai-label-row">
              <label for="ai-context" class="ai-label">Message with event details</label>
              <span class="ai-required">Required</span>
            </div>
            <UiTextarea
              id="ai-context"
              v-model="text"
              class="ai-message"
              :rows="5"
              placeholder="Enter a message with event details…"
              :disabled="parsing || applying"
              required
              aria-required="true"
              autofocus
              @update:model-value="onTextInput"
            />
          </div>

          <div
            class="ai-drop"
            :class="{ 'ai-drop--active': dragging, 'ai-drop--filled': !!imageDataUrl }"
            @dragover.prevent="dragging = true"
            @dragleave.prevent="dragging = false"
            @drop.prevent="onDrop"
          >
            <template v-if="imageDataUrl">
              <img :src="imageDataUrl" :alt="imageName || 'Attached image'" class="ai-thumb" />
              <div class="ai-drop-copy">
                <span class="ai-drop-title">{{ imageName || "Image attached" }}</span>
              </div>
              <button type="button" class="ai-clear" aria-label="Remove image" @click="clearImage">
                <PhX :size="18" aria-hidden="true" />
              </button>
            </template>
            <template v-else>
              <PhImage :size="22" class="ai-drop-icon" aria-hidden="true" />
              <div class="ai-drop-copy">
                <span class="ai-drop-title">Upload image (optional)</span>
              </div>
              <button type="button" class="ai-browse" :disabled="parsing || applying" @click="fileInput?.click()">
                Browse
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

          <p v-if="error" class="ai-error" role="alert">
            <PhWarning :size="16" weight="fill" class="ai-error-icon" aria-hidden="true" />
            <span>{{ error }}</span>
          </p>

          <div class="ai-actions">
            <UiButton :disabled="parsing || applying || !hasMessage" @click="parse">
              <PhSparkle :size="16" weight="fill" aria-hidden="true" />
              Generate Event
            </UiButton>
            <UiButton
              variant="ghost"
              :disabled="parsing || applying || !hasSource"
              @click="startOver"
            >
              Clear
            </UiButton>
          </div>
        </template>

        <!-- ── 2a. Reading the source ── -->
        <template v-else-if="stage === 'reading'">
          <div class="ai-progress" role="status" aria-live="polite">
            <span class="ai-spinner" aria-hidden="true" />
            <div>
              <p class="ai-progress-title">Generating event details…</p>
              <p class="ai-progress-text">Reading the message. This can take a few seconds.</p>
            </div>
          </div>

          <details v-if="streamReasoning || streamContent" class="ai-activity">
            <summary class="ai-activity-summary">Model activity</summary>
            <div ref="streamBox" class="ai-activity-body">
              <template v-if="streamReasoning">
                <p class="ai-activity-label">Reasoning</p>
                <pre class="ai-activity-text">{{ streamReasoning }}</pre>
              </template>
              <template v-if="streamContent">
                <p class="ai-activity-label">Output</p>
                <pre class="ai-activity-text">{{ streamContent }}</pre>
              </template>
            </div>
          </details>
        </template>

        <!-- ── 2b. Answer the harness's questions ── -->
        <template v-else-if="stage === 'questions'">
          <div class="ai-review">
            <h4 ref="resultsHeading" tabindex="-1" class="ai-results-title">
              {{ questions.length === 1 ? "One detail to confirm" : `${questions.length} details to confirm` }}
            </h4>
            <p class="ai-results-sub">
              Smart import needs an answer before it can finish these events.
            </p>
          </div>

          <ul class="ai-questions">
            <li
              v-for="question in questions"
              :key="question.id"
              class="ai-question"
            >
              <div class="ai-question-head">
                <span class="ai-question-kind">
                  {{ question.kind === "assignee" ? "Who it's for" : question.kind === "conflict" ? "Schedule" : "Confirm" }}
                </span>
                <p class="ai-question-text">{{ question.question }}</p>
              </div>
              <div v-if="question.options.length" class="ai-question-options">
                <button
                  v-for="option in question.options"
                  :key="option"
                  type="button"
                  class="ai-question-option"
                  :class="{ 'ai-question-option--active': answers[question.id] === option }"
                  @click="chooseAnswer(question, option)"
                >
                  {{ option }}
                </button>
              </div>
              <UiInput
                v-model="answers[question.id]"
                :placeholder="question.options.length ? 'Or type another answer' : 'Type an answer'"
                :aria-label="question.question"
                maxlength="2000"
              />
            </li>
          </ul>

          <p v-if="error" class="ai-error" role="alert">
            <PhWarning :size="16" weight="fill" class="ai-error-icon" aria-hidden="true" />
            <span>{{ error }}</span>
          </p>

          <div class="ai-actions">
            <UiButton :disabled="parsing || !canAnswerQuestions" @click="answerQuestions">
              Continue
            </UiButton>
            <UiButton
              v-if="drafts.length > 0"
              variant="ghost"
              :disabled="parsing"
              @click="skipQuestions"
            >
              Review events anyway
            </UiButton>
            <UiButton
              v-else
              variant="ghost"
              :disabled="parsing"
              @click="startOver"
            >
              Start over
            </UiButton>
          </div>
        </template>

        <!-- ── 2c. Review the drafts ── -->
        <template v-else-if="stage === 'review'">
          <div
            v-if="outcome && outcome !== 'success'"
            class="ai-callout"
            :class="outcome === 'failed' ? 'ai-callout--danger' : 'ai-callout--warning'"
            role="status"
          >
            <PhWarning :size="18" weight="fill" class="ai-callout-icon" aria-hidden="true" />
            <div class="ai-callout-copy">
              <p class="ai-callout-title">{{ outcomeMessage }}</p>
              <p class="ai-callout-text">{{ outcomeHint }}</p>
            </div>
          </div>

          <div v-if="blockingConflicts.length > 0" class="ai-callout ai-callout--warning" role="alert">
            <PhWarning :size="18" weight="fill" class="ai-callout-icon" aria-hidden="true" />
            <div class="ai-callout-copy">
              <p class="ai-callout-title">
                {{ blockingConflicts.length === 1 ? "Schedule conflict" : "Schedule conflicts" }}
              </p>
              <p class="ai-callout-text">
                These events overlap another event. Choose what to do.
              </p>
              <ul class="ai-conflicts">
                <li v-for="conflict in blockingConflicts" :key="conflict.id" class="ai-conflict">
                  <p class="ai-conflict-text">{{ conflict.message }}</p>
                  <div class="ai-conflict-actions">
                    <UiButton size="sm" variant="ghost" @click="editConflict(conflict)">
                      Change time
                    </UiButton>
                    <UiButton size="sm" variant="ghost" @click="dismissConflict(conflict.id)">
                      Add anyway
                    </UiButton>
                  </div>
                </li>
              </ul>
            </div>
          </div>

          <div v-if="addedDrafts.length > 0" class="ai-added">
            <p class="ai-added-title">Added</p>
            <ul class="ai-added-list">
              <li
                v-for="(draft, index) in addedDrafts"
                :key="`added-${draft.title}-${index}`"
                class="ai-added-item"
              >
                <span class="ai-added-copy">
                  <span class="ai-added-name">{{ draft.title }}</span>
                  <span class="ai-added-when">{{ formatWhen(draft) }}</span>
                </span>
              </li>
            </ul>
          </div>

          <div class="ai-results">
            <div class="ai-results-head">
              <div>
                <h4 ref="resultsHeading" tabindex="-1" class="ai-results-title">
                  {{ drafts.length }} {{ drafts.length === 1 ? "event" : "events" }} generated
                </h4>
                <p class="ai-results-sub">Review before adding.</p>
              </div>
              <button type="button" class="ai-select-all" @click="toggleAll">
                {{ selectedCount === drafts.length ? "Select none" : "Select all" }}
              </button>
            </div>

            <div v-if="reviewNotes.length" class="ai-callout ai-callout--warning">
              <PhWarning :size="18" weight="fill" class="ai-callout-icon" aria-hidden="true" />
              <div class="ai-callout-copy">
                <p class="ai-callout-title">Worth checking</p>
                <ul class="ai-warnings">
                  <li v-for="note in reviewNotes" :key="note">{{ note }}</li>
                </ul>
              </div>
            </div>

            <ul class="ai-list">
              <li
                v-for="(draft, index) in drafts"
                :key="`${draft.title}-${index}`"
                class="ai-item"
                :class="{
                  'ai-item--low': draft.confidence < 0.6,
                  'ai-item--editing': editingIndex === index,
                }"
              >
                <div class="ai-item-main">
                  <input
                    :id="`${uid}-draft-${index}`"
                    type="checkbox"
                    class="ai-checkbox"
                    :checked="selected[index]"
                    :aria-label="`Add ${draft.title}`"
                    @change="toggle(index)"
                  />
                  <label :for="`${uid}-draft-${index}`" class="ai-item-copy">
                    <span class="ai-item-title">{{ draft.title }}</span>
                    <span class="ai-item-when">{{ formatWhen(draft) }}</span>
                    <span v-if="repeatLabel(draft)" class="ai-item-repeat">{{ repeatLabel(draft) }}</span>
                    <span v-if="draftMeta(draft)" class="ai-item-meta">{{ draftMeta(draft) }}</span>
                    <span v-if="shortDescription(draft)" class="ai-item-desc">{{ shortDescription(draft) }}</span>
                    <span v-if="draft.confidence < 0.6" class="ai-item-flag">
                      <PhWarning :size="13" weight="fill" aria-hidden="true" />
                      Check details
                    </span>
                  </label>
                  <button
                    type="button"
                    class="ai-item-edit"
                    :aria-expanded="editingIndex === index"
                    :aria-controls="editingIndex === index ? `${uid}-editor-${index}` : undefined"
                    :aria-label="`Edit ${draft.title}`"
                    @click="openEditor(index)"
                  >
                    {{ editingIndex === index ? "Close" : "Edit" }}
                  </button>
                </div>

                <div
                  v-if="editingIndex === index && editBuffer"
                  :id="`${uid}-editor-${index}`"
                  class="ai-item-editor"
                  @keydown.esc.stop.prevent="cancelEdit"
                >
                  <div class="ai-edit-field">
                    <label :for="`${uid}-edit-title`" class="ai-edit-label">Title</label>
                    <UiInput :id="`${uid}-edit-title`" v-model="editBuffer.title" class="ai-edit-title" />
                  </div>
                  <div class="ai-edit-row">
                    <div class="ai-edit-field">
                      <label :for="`${uid}-edit-date`" class="ai-edit-label">Date</label>
                      <UiInput :id="`${uid}-edit-date`" v-model="editBuffer.date" type="date" />
                    </div>
                    <div class="ai-edit-field">
                      <label :for="`${uid}-edit-end-date`" class="ai-edit-label">
                        End date <span class="ai-edit-optional">optional</span>
                      </label>
                      <UiInput
                        :id="`${uid}-edit-end-date`"
                        v-model="editBuffer.endDate"
                        type="date"
                        :min="editBuffer.date"
                      />
                    </div>
                  </div>
                  <label class="ai-edit-toggle">
                    <input v-model="editBuffer.allDay" type="checkbox" />
                    <span>All day</span>
                  </label>
                  <div v-if="memberOptions.length" class="ai-edit-field">
                    <label :for="`${uid}-edit-assignee`" class="ai-edit-label">Assigned to</label>
                    <UiSelect
                      :id="`${uid}-edit-assignee`"
                      v-model="editBuffer.assigneeId"
                    >
                      <option value="">No one</option>
                      <option v-for="member in memberOptions" :key="member.id" :value="member.id">
                        {{ member.name }}
                      </option>
                    </UiSelect>
                  </div>
                  <div v-if="!editBuffer.allDay" class="ai-edit-row">
                    <div class="ai-edit-field">
                      <label :for="`${uid}-edit-start`" class="ai-edit-label">Start</label>
                      <UiInput :id="`${uid}-edit-start`" v-model="editBuffer.start" type="time" />
                    </div>
                    <div class="ai-edit-field">
                      <label :for="`${uid}-edit-end`" class="ai-edit-label">End</label>
                      <UiInput :id="`${uid}-edit-end`" v-model="editBuffer.end" type="time" />
                    </div>
                  </div>
                  <p v-if="editError" class="ai-edit-error" role="alert">
                    <PhWarning :size="14" weight="fill" aria-hidden="true" />
                    <span>{{ editError }}</span>
                  </p>
                  <div class="ai-edit-actions">
                    <UiButton size="sm" variant="ghost" @click="cancelEdit">Cancel</UiButton>
                    <UiButton size="sm" :disabled="!!editError" @click="saveEdit">Save changes</UiButton>
                  </div>
                </div>
              </li>
            </ul>

            <div v-if="editingIndex === null" class="ai-add-bar">
              <span class="ai-add-count">
                {{ blockingConflicts.length > 0 ? "Resolve the conflicts above first." : `${selectedCount} of ${drafts.length} selected` }}
              </span>
              <UiButton
                :disabled="applying || selectedCount === 0 || editingIndex !== null || blockingConflicts.length > 0"
                @click="applySelected"
              >
                {{ applying ? "Adding…" : `Add ${selectedCount} ${selectedCount === 1 ? "event" : "events"}` }}
              </UiButton>
            </div>
          </div>
        </template>

        <!-- ── 2c. Nothing dated found ── -->
        <template v-else-if="stage === 'empty'">
          <div class="ai-empty" role="status">
            <PhSparkle :size="22" weight="duotone" class="ai-empty-icon" aria-hidden="true" />
            <div>
              <h4 ref="resultsHeading" tabindex="-1" class="ai-empty-title">No events generated</h4>
              <p class="ai-empty-copy">
                HOMST didn't find a date it could use. Add more detail, or add the
                event manually.
              </p>
            </div>
          </div>

          <div v-if="reviewNotes.length" class="ai-callout ai-callout--warning">
            <PhWarning :size="18" weight="fill" class="ai-callout-icon" aria-hidden="true" />
            <div class="ai-callout-copy">
              <p class="ai-callout-title">Worth checking</p>
              <ul class="ai-warnings">
                <li v-for="note in reviewNotes" :key="note">{{ note }}</li>
              </ul>
            </div>
          </div>

          <div class="ai-actions">
            <UiButton @click="emit('manual')">Add manually</UiButton>
          </div>
        </template>

        <!-- ── 3. Done ── -->
        <template v-else>
          <div class="ai-done">
            <div class="ai-done-head">
              <span class="ai-done-icon" aria-hidden="true">
                <PhCheck :size="20" weight="bold" />
              </span>
              <div>
                <h4 ref="resultsHeading" tabindex="-1" class="ai-done-title">{{ outcomeMessage }}</h4>
                <p class="ai-done-copy">The message is saved with each event.</p>
              </div>
            </div>

            <p class="ai-added-title">Recently added</p>
            <ul class="ai-added-list">
              <li
                v-for="(draft, index) in addedDrafts"
                :key="`${draft.title}-${index}`"
                class="ai-added-item"
              >
                <span class="ai-added-copy">
                  <span class="ai-added-name">{{ draft.title }}</span>
                  <span class="ai-added-when">{{ formatWhen(draft) }}</span>
                  <span v-if="repeatLabel(draft)" class="ai-added-repeat">{{ repeatLabel(draft) }}</span>
                </span>
              </li>
            </ul>

            <div class="ai-actions">
              <UiButton @click="finish">Done</UiButton>
              <UiButton variant="ghost" @click="startOver">Add another</UiButton>
            </div>
          </div>
        </template>
      </div>
    </template>
  </div>
</template>

<style scoped>
.ai-import {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.ai-stage {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  animation: ai-stage-in var(--duration-base) ease-out both;
}

@keyframes ai-stage-in {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: translateY(0); }
}

@media (prefers-reduced-motion: reduce) {
  .ai-stage,
  .ai-spinner {
    animation: none !important;
  }
}

html.low-power .ai-spinner {
  animation: none;
}

/* ── Input ── */
.ai-field {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.ai-label-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
}

.ai-label {
  color: var(--color-textSecondary);
  font-size: var(--text-label-size);
  font-weight: var(--font-weight-medium);
}

.ai-required {
  flex-shrink: 0;
  padding: 1px var(--space-2);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-full);
  color: var(--color-textSecondary);
  font-size: var(--text-micro-size);
  line-height: 1.6;
}

.ai-message {
  min-height: 132px;
  caret-color: var(--color-accent-darker);
}

.ai-message::placeholder {
  color: var(--color-textSecondary);
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
  background: color-mix(in srgb, var(--color-accent-base) 14%, var(--color-bgSubtle));
}

.ai-drop-icon {
  flex-shrink: 0;
  color: var(--color-textSecondary);
}

.ai-drop-copy {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.ai-drop-title {
  color: var(--color-textPrimary);
  font-size: var(--text-body-size);
  font-weight: var(--font-weight-medium);
  overflow-wrap: anywhere;
}

.ai-thumb {
  flex-shrink: 0;
  width: 54px;
  height: 54px;
  border-radius: var(--radius-xs);
  object-fit: cover;
}

.ai-file {
  display: none;
}

.ai-browse {
  flex-shrink: 0;
  min-height: 48px;
  padding: 0 var(--space-2);
  border: none;
  border-radius: var(--radius-full);
  background: transparent;
  color: var(--color-accent-darker);
  font-family: var(--font-family);
  font-size: var(--text-label-size);
  font-weight: var(--font-weight-medium);
  cursor: pointer;
}

.ai-browse:hover {
  background: color-mix(in srgb, var(--color-accent-base) 18%, transparent);
}

.ai-clear {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  border: none;
  border-radius: var(--radius-full);
  background: transparent;
  color: var(--color-textSecondary);
  cursor: pointer;
}

.ai-clear:hover {
  background: var(--color-bgSurface);
}

.ai-error {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
  margin: 0;
  padding: var(--space-3) var(--space-4);
  border: 1px solid color-mix(in srgb, var(--color-danger) 45%, transparent);
  border-radius: var(--radius-sm);
  background: color-mix(in srgb, var(--color-danger) 10%, var(--color-bgSurface));
  color: var(--color-textPrimary);
  font-size: var(--text-label-size);
  line-height: 1.5;
}

.ai-error-icon {
  flex-shrink: 0;
  margin-top: 1px;
  color: var(--color-danger);
}

.ai-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-start;
  gap: var(--space-3);
}

/* ── Loading and status ── */
.ai-loading {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-4);
  color: var(--color-textSecondary);
  font-size: var(--text-body-size);
}

.ai-spinner {
  flex-shrink: 0;
  width: 18px;
  height: 18px;
  border: 2px solid var(--color-borderStrong);
  border-top-color: var(--color-accent-darker);
  border-radius: var(--radius-full);
  animation: ai-spin 0.8s linear infinite;
}

@keyframes ai-spin {
  to { transform: rotate(360deg); }
}

.ai-setup {
  display: flex;
  align-items: flex-start;
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

.ai-setup-copy {
  flex: 1;
  min-width: 0;
}

.ai-setup-title {
  margin: 0 0 2px;
  color: var(--color-textPrimary);
  font-size: var(--text-body-size);
  font-weight: var(--font-weight-medium);
}

.ai-setup-text {
  margin: 0;
  color: var(--color-textSecondary);
  font-size: var(--text-label-size);
  line-height: 1.5;
}

/* ── Callouts ── */
.ai-callout {
  display: flex;
  align-items: flex-start;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-bgSubtle);
}

.ai-callout--warning {
  border-color: color-mix(in srgb, var(--color-warning) 45%, transparent);
  background: color-mix(in srgb, var(--color-warning) 10%, var(--color-bgSurface));
}

.ai-callout--danger {
  border-color: color-mix(in srgb, var(--color-danger) 45%, transparent);
  background: color-mix(in srgb, var(--color-danger) 10%, var(--color-bgSurface));
}

.ai-callout-icon {
  flex-shrink: 0;
  margin-top: 2px;
  color: var(--color-warning);
}

.ai-callout--danger .ai-callout-icon {
  color: var(--color-danger);
}

.ai-callout-copy {
  flex: 1;
  min-width: 0;
}

.ai-callout-title {
  margin: 0;
  color: var(--color-textPrimary);
  font-size: var(--text-body-size);
  font-weight: var(--font-weight-medium);
  line-height: 1.4;
}

.ai-callout-text {
  margin: 2px 0 0;
  color: var(--color-textSecondary);
  font-size: var(--text-label-size);
  line-height: 1.5;
}

.ai-warnings {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin: 4px 0 0;
  padding-left: var(--space-4);
  color: var(--color-textSecondary);
  font-size: var(--text-label-size);
  line-height: 1.5;
}

/* ── Source review ── */
.ai-source {
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-bgSurface);
  overflow: hidden;
}

.ai-source-summary {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-height: 48px;
  padding: var(--space-2) var(--space-3);
  cursor: pointer;
  list-style: none;
}

.ai-source-summary::-webkit-details-marker {
  display: none;
}

.ai-source-icon {
  flex-shrink: 0;
  color: var(--color-accent-darker);
}

.ai-source-copy {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}

.ai-source-title {
  color: var(--color-textPrimary);
  font-size: var(--text-label-size);
  font-weight: var(--font-weight-medium);
}

.ai-source-preview {
  overflow: hidden;
  color: var(--color-textSecondary);
  font-size: var(--text-label-size);
  line-height: 1.4;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ai-source-open {
  flex-shrink: 0;
  color: var(--color-accent-darker);
  font-size: var(--text-label-size);
  font-weight: var(--font-weight-medium);
}

.ai-source-body {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  max-height: 220px;
  overflow-y: auto;
  padding: var(--space-3);
  border-top: 1px solid var(--color-border);
}

.ai-source-text {
  margin: 0;
  color: var(--color-textSecondary);
  font-family: var(--font-family);
  font-size: var(--text-label-size);
  line-height: 1.5;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.ai-source-image {
  max-width: 100%;
  border-radius: var(--radius-xs);
}

.ai-source-actions {
  display: flex;
  justify-content: flex-end;
  padding: 0 var(--space-3);
  border-top: 1px solid var(--color-border);
}

.ai-source-edit {
  min-height: 48px;
  padding: 0 var(--space-2);
  border: none;
  background: transparent;
  color: var(--color-accent-darker);
  font-family: var(--font-family);
  font-size: var(--text-label-size);
  font-weight: var(--font-weight-medium);
  cursor: pointer;
}

.ai-source-edit:hover {
  background: var(--color-bgSubtle);
}

/* ── Reading ── */
.ai-progress {
  display: flex;
  align-items: flex-start;
  gap: var(--space-3);
  padding: var(--space-4);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-bgSubtle);
}

.ai-progress .ai-spinner {
  margin-top: 2px;
}

.ai-progress-title {
  margin: 0;
  color: var(--color-textPrimary);
  font-size: var(--text-body-size);
  font-weight: var(--font-weight-medium);
}

.ai-progress-text {
  margin: 2px 0 0;
  color: var(--color-textSecondary);
  font-size: var(--text-label-size);
  line-height: 1.5;
}

.ai-activity {
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-bgSubtle);
  padding: 0 var(--space-3);
}

.ai-activity-summary {
  display: flex;
  align-items: center;
  min-height: 48px;
  color: var(--color-textSecondary);
  font-size: var(--text-label-size);
  font-weight: var(--font-weight-medium);
  cursor: pointer;
  list-style: none;
}

.ai-activity-summary::-webkit-details-marker {
  display: none;
}

.ai-activity-body {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  max-height: 200px;
  overflow-y: auto;
  padding-bottom: var(--space-3);
}

.ai-activity-label {
  margin: 0;
  color: var(--color-textSecondary);
  font-size: var(--text-micro-size);
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.ai-activity-text {
  margin: 0;
  color: var(--color-textSecondary);
  font-family: var(--font-mono, monospace);
  font-size: var(--text-label-size);
  line-height: 1.5;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

/* ── Review ── */
.ai-results {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.ai-results-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-3);
}

.ai-results-title {
  margin: 0;
  color: var(--color-textPrimary);
  font-size: var(--text-heading-size);
  font-weight: var(--font-weight-medium);
  line-height: var(--text-heading-line-height);
}

.ai-results-title:focus {
  outline: none;
}

.ai-results-sub {
  margin: 2px 0 0;
  color: var(--color-textSecondary);
  font-size: var(--text-label-size);
  line-height: 1.4;
}

.ai-select-all {
  flex-shrink: 0;
  min-height: 48px;
  padding: 0 var(--space-1);
  border: none;
  background: transparent;
  color: var(--color-accent-darker);
  font-family: var(--font-family);
  font-size: var(--text-label-size);
  font-weight: var(--font-weight-medium);
  cursor: pointer;
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

.ai-item--low {
  border-color: color-mix(in srgb, var(--color-warning) 45%, var(--color-border));
}

.ai-item--editing {
  border-color: var(--color-accent-darker);
  scroll-margin-top: var(--space-3);
}

.ai-item-main {
  display: flex;
  align-items: flex-start;
  gap: var(--space-3);
  padding: var(--space-3);
}

.ai-checkbox {
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  margin-top: 2px;
  accent-color: var(--color-accent-darker);
}

.ai-item-copy {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
  cursor: pointer;
}

.ai-item-title {
  color: var(--color-textPrimary);
  font-size: var(--text-body-size);
  font-weight: var(--font-weight-medium);
  line-height: 1.4;
  overflow-wrap: anywhere;
}

.ai-item-when,
.ai-item-meta,
.ai-item-repeat,
.ai-item-desc {
  color: var(--color-textSecondary);
  font-size: var(--text-label-size);
  line-height: 1.4;
  font-variant-numeric: tabular-nums;
}

.ai-item-repeat {
  color: var(--color-accent-darker);
}

.ai-item-desc {
  display: -webkit-box;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow-wrap: anywhere;
}

.ai-item-flag {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  width: fit-content;
  margin-top: 3px;
  padding: 2px var(--space-2);
  border: 1px solid color-mix(in srgb, var(--color-warning) 45%, transparent);
  border-radius: var(--radius-full);
  background: color-mix(in srgb, var(--color-warning) 14%, var(--color-bgSurface));
  color: var(--color-textPrimary);
  font-size: var(--text-label-size);
  font-weight: var(--font-weight-medium);
}

.ai-item-edit {
  flex-shrink: 0;
  min-width: 48px;
  min-height: 48px;
  padding: 0 var(--space-2);
  border: none;
  border-radius: var(--radius-full);
  background: transparent;
  color: var(--color-accent-darker);
  font-family: var(--font-family);
  font-size: var(--text-label-size);
  font-weight: var(--font-weight-medium);
  cursor: pointer;
}

.ai-item-edit:hover {
  background: var(--color-bgSubtle);
}

.ai-item-editor {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-3);
  border-top: 1px solid var(--color-border);
}

.ai-edit-row {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
}

.ai-edit-field {
  display: flex;
  flex: 1 1 120px;
  flex-direction: column;
  gap: var(--space-1);
  min-width: 0;
}

.ai-edit-label {
  color: var(--color-textSecondary);
  font-size: var(--text-label-size);
  font-weight: var(--font-weight-medium);
}

.ai-edit-optional {
  color: var(--color-textSecondary);
  font-size: var(--text-micro-size);
  font-weight: var(--font-weight-regular);
}

.ai-edit-toggle {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  width: fit-content;
  min-height: 48px;
  color: var(--color-textSecondary);
  font-size: var(--text-body-size);
  cursor: pointer;
}

.ai-edit-toggle input {
  width: 20px;
  height: 20px;
  accent-color: var(--color-accent-darker);
}

.ai-edit-error {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  margin: 0;
  color: var(--color-textPrimary);
  font-size: var(--text-label-size);
}

.ai-edit-error svg {
  flex-shrink: 0;
  color: var(--color-danger);
}

.ai-edit-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
}

.ai-add-bar {
  position: sticky;
  bottom: 0;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  padding: var(--space-3) 0;
  border-top: 1px solid var(--color-border);
  background: var(--color-bgElevated);
}

.ai-add-count {
  color: var(--color-textSecondary);
  font-size: var(--text-label-size);
  font-variant-numeric: tabular-nums;
}

/* ── Questions and conflicts ── */
.ai-review {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.ai-questions,
.ai-conflicts {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  margin: 0;
  padding: 0;
  list-style: none;
}

.ai-question {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-bgSurface);
}

.ai-question-head {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.ai-question-kind {
  width: fit-content;
  padding: 2px var(--space-2);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-full);
  color: var(--color-textSecondary);
  font-size: var(--text-micro-size);
  line-height: 1.6;
}

.ai-question-text {
  margin: 0;
  color: var(--color-textPrimary);
  font-size: var(--text-body-size);
  font-weight: var(--font-weight-medium);
  line-height: 1.4;
  overflow-wrap: anywhere;
}

.ai-question-options {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.ai-question-option {
  min-height: 48px;
  padding: 0 var(--space-3);
  border: 1px solid var(--color-borderStrong);
  border-radius: var(--radius-full);
  background: var(--color-bgSubtle);
  color: var(--color-textPrimary);
  font-family: var(--font-family);
  font-size: var(--text-label-size);
  font-weight: var(--font-weight-medium);
  cursor: pointer;
  transition: border-color var(--duration-fast), background var(--duration-fast);
}

.ai-question-option:hover {
  border-color: var(--color-accent-darker);
}

.ai-question-option--active {
  border-color: var(--color-accent-darker);
  background: color-mix(in srgb, var(--color-accent-base) 22%, var(--color-bgSurface));
}

.ai-conflict {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding-top: var(--space-2);
  border-top: 1px solid color-mix(in srgb, var(--color-warning) 30%, transparent);
}

.ai-conflict:first-child {
  padding-top: 0;
  border-top: none;
}

.ai-conflict-text {
  margin: 0;
  color: var(--color-textPrimary);
  font-size: var(--text-label-size);
  line-height: 1.5;
}

.ai-conflict-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

/* ── Empty ── */
.ai-empty {
  display: flex;
  align-items: flex-start;
  gap: var(--space-3);
  padding: var(--space-4);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-bgSubtle);
}

.ai-empty-icon {
  flex-shrink: 0;
  color: var(--color-textSecondary);
}

.ai-empty-title {
  margin: 0;
  color: var(--color-textPrimary);
  font-size: var(--text-heading-size);
  font-weight: var(--font-weight-medium);
}

.ai-empty-title:focus {
  outline: none;
}

.ai-empty-copy {
  margin: 2px 0 0;
  color: var(--color-textSecondary);
  font-size: var(--text-label-size);
  line-height: 1.5;
}

/* ── Done ── */
.ai-done {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.ai-done-head {
  display: flex;
  align-items: flex-start;
  gap: var(--space-3);
  padding: var(--space-4);
  border: 1px solid color-mix(in srgb, var(--color-success) 45%, transparent);
  border-radius: var(--radius-sm);
  background: color-mix(in srgb, var(--color-success) 12%, var(--color-bgSurface));
}

.ai-done-icon {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: var(--radius-full);
  background: color-mix(in srgb, var(--color-success) 18%, var(--color-bgSurface));
  color: var(--color-success);
}

.ai-done-title {
  margin: 0;
  color: var(--color-textPrimary);
  font-size: var(--text-heading-size);
  font-weight: var(--font-weight-medium);
  line-height: 1.4;
}

.ai-done-title:focus {
  outline: none;
}

.ai-done-copy {
  margin: 2px 0 0;
  color: var(--color-textSecondary);
  font-size: var(--text-label-size);
  line-height: 1.5;
}

.ai-added {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.ai-added-title {
  margin: 0;
  color: var(--color-textSecondary);
  font-size: var(--text-label-size);
  font-weight: var(--font-weight-medium);
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
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-bgSurface);
}

.ai-added-copy {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}

.ai-added-name {
  color: var(--color-textPrimary);
  font-size: var(--text-body-size);
  font-weight: var(--font-weight-medium);
  overflow-wrap: anywhere;
}

.ai-added-when,
.ai-added-repeat {
  color: var(--color-textSecondary);
  font-size: var(--text-label-size);
  font-variant-numeric: tabular-nums;
}

.ai-added-repeat {
  color: var(--color-accent-darker);
}

/* ── Focus ── */
.ai-browse:focus-visible,
.ai-clear:focus-visible,
.ai-select-all:focus-visible,
.ai-item-edit:focus-visible,
.ai-question-option:focus-visible,
.ai-checkbox:focus-visible,
.ai-edit-toggle input:focus-visible,
.ai-source-summary:focus-visible,
.ai-source-edit:focus-visible,
.ai-activity-summary:focus-visible {
  outline: 2px solid var(--color-accent-darker);
  outline-offset: 2px;
}

/* Futur uses ink contours and hard offset shadows; match that world. These
   live last because they share specificity with the base rules above. */
:global(.futur .ai-drop) {
  border: 2px dashed var(--color-ink);
}

:global(.futur .ai-source),
:global(.futur .ai-item),
:global(.futur .ai-progress),
:global(.futur .ai-activity),
:global(.futur .ai-empty) {
  border: 2px solid var(--color-ink);
  box-shadow: 0 2px 0 0 var(--color-ink);
}

:global(.futur .ai-item--low) {
  border-color: var(--color-warningFill);
}

:global(.futur .ai-item--editing) {
  border-color: var(--color-accent-darker);
}

:global(.futur .ai-add-bar) {
  border-top: 2px solid var(--color-ink);
}
</style>
