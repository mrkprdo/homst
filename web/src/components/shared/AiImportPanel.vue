<script setup lang="ts">
import { computed, nextTick, onMounted, ref, useId, watch } from "vue"
import {
  PhArrowUp,
  PhChatCircleDots,
  PhCheck,
  PhImage,
  PhPencilSimple,
  PhPlus,
  PhSparkle,
  PhWarning,
  PhX,
} from "@phosphor-icons/vue"
import {
  aiApi,
  parseStream,
  type AiChatMessage,
  type AiClarification,
  type AiConflict,
  type AiConversationTurn,
  type AiDraft,
  type AiEventDelete,
  type AiEventUpdate,
  type AiParseResult,
  type AiQuestion,
  type AiStatus,
} from "@/api/ai"
import { calendarApi } from "@/api/calendar"
import { useEvents } from "@/composables/useEvents"
import UiButton from "@/components/ui/UiButton.vue"
import UiInput from "@/components/ui/UiInput.vue"
import UiSelect from "@/components/ui/UiSelect.vue"
import { reminderLabel } from "@/utils/reminders"

const props = defineProps<{
  memberNames?: Record<string, string>
  /** Reopen a saved thread (from an imported event). */
  conversationId?: string
  /** The event this resumed thread should update instead of creating. */
  focusEventId?: string
  focusEventTitle?: string
  /** Original import text, used when the event has no saved conversation. */
  focusSourceMessage?: string
}>()
const emit = defineEmits<{ done: [count: number]; manual: [] }>()

const { events, ensureDefaultCalendar, removeEvent, upsertEvent } = useEvents()

const uid = useId()
const rootEl = ref<HTMLElement | null>(null)
const transcriptEl = ref<HTMLElement | null>(null)
const composerEl = ref<HTMLTextAreaElement | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)

const status = ref<AiStatus | null>(null)
const statusLoading = ref(true)
const statusError = ref("")
const configured = computed(() => status.value?.configured === true)

interface Attachment {
  dataUrl: string
  name: string
}

type TurnStatus = "reading" | "ready" | "empty" | "error"
type Outcome = "success" | "partial" | "failed"

interface Turn {
  id: number
  role: "user" | "assistant"
  text: string
  image: Attachment | null
  imageName: string
  /** Stored copy of this turn's screenshot, so a reopened chat shows it. */
  imageUrl: string
  status: TurnStatus
  reply: string
  drafts: AiDraft[]
  selected: boolean[]
  updates: AiEventUpdate[]
  updateSelected: boolean[]
  deletes: AiEventDelete[]
  deleteSelected: boolean[]
  warnings: string[]
  questions: AiQuestion[]
  conflicts: AiConflict[]
  replacements: AiConflict[]
  added: AiDraft[]
  outcome: Outcome | null
  failed: number
  error: string
  reasoning: string
  rawResponse: string
  documentKind: string
  actions: string[]
  actionsDeclared: boolean
  clarifications: AiClarification[]
  requestText: string
  requestImage: Attachment | null
  applied: boolean
}

let nextTurnId = 1

function userTurn(text: string, image: Attachment | null): Turn {
  return {
    id: nextTurnId++,
    role: "user",
    text,
    image,
    imageName: image?.name ?? "",
    imageUrl: "",
    status: "ready",
    reply: "",
    drafts: [],
    selected: [],
    updates: [],
    updateSelected: [],
    deletes: [],
    deleteSelected: [],
    warnings: [],
    questions: [],
    conflicts: [],
    replacements: [],
    added: [],
    outcome: null,
    failed: 0,
    error: "",
    reasoning: "",
    rawResponse: "",
    documentKind: "other",
    actions: [],
    actionsDeclared: false,
    clarifications: [],
    requestText: "",
    requestImage: null,
    applied: false,
  }
}

function assistantTurn(text = "", image: Attachment | null = null): Turn {
  return {
    id: nextTurnId++,
    role: "assistant",
    text: "",
    image: null,
    imageName: "",
    imageUrl: "",
    status: "reading",
    reply: "",
    drafts: [],
    selected: [],
    updates: [],
    updateSelected: [],
    deletes: [],
    deleteSelected: [],
    warnings: [],
    questions: [],
    conflicts: [],
    replacements: [],
    added: [],
    outcome: null,
    failed: 0,
    error: "",
    reasoning: "",
    rawResponse: "",
    documentKind: "other",
    actions: [],
    actionsDeclared: false,
    clarifications: [],
    requestText: text,
    requestImage: image,
    applied: false,
  }
}

const turns = ref<Turn[]>([])
const composerText = ref("")
const pendingImage = ref<Attachment | null>(null)
const parsing = ref(false)
const applying = ref(false)
const inputError = ref("")
const dragging = ref(false)
const announcement = ref("")

const clarifications = ref<AiClarification[]>([])
const datetimeAnswers = ref<Record<string, { date: string; time: string }>>({})
const conversationId = ref(props.conversationId ?? "")
const loadingConversation = ref(false)
const conversationError = ref("")
const seededSource = ref(false)
let saveChain: Promise<string> = Promise.resolve("")

const seedNotice = computed(() => {
  if (!props.focusEventId || props.conversationId || !seededSource.value) return ""
  return "No saved chat history for this event. Here's the original message; tell me what to change."
})

const focusEvent = computed(() =>
  props.focusEventId
    ? events.value.find(event => event.id === props.focusEventId) ?? null
    : null,
)

const TIME_SLOTS = Array.from({ length: 48 }, (_, index) => {
  const total = index * 30
  const value = `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`
  const label = new Date(2000, 0, 1, Math.floor(total / 60), total % 60)
    .toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
  return { value, label }
})
const todayIso = computed(() => {
  const now = new Date()
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
})

const hasConversation = computed(() => turns.value.length > 0)
const activeAssistant = computed<Turn | null>(() => {
  for (let index = turns.value.length - 1; index >= 0; index -= 1) {
    const turn = turns.value[index]
    if (turn?.role === "assistant") return turn
  }
  return null
})
const canSend = computed(
  () =>
    !parsing.value &&
    !applying.value &&
    (composerText.value.trim().length > 0 || !!pendingImage.value),
)
const memberOptions = computed(() =>
  Object.entries(props.memberNames ?? {})
    .filter(([, name]) => !!name)
    .map(([id, name]) => ({ id, name }))
    .sort((first, second) => first.name.localeCompare(second.name)),
)

function isActive(turn: Turn): boolean {
  return activeAssistant.value?.id === turn.id
}

function selectedCount(turn: Turn): number {
  return (
    turn.selected.filter(Boolean).length +
    turn.updateSelected.filter(Boolean).length +
    turn.deleteSelected.filter(Boolean).length
  )
}

function actionCount(turn: Turn): number {
  return turn.drafts.length + turn.updates.length + turn.deletes.length
}

function hasExistingChanges(turn: Turn): boolean {
  return turn.updates.length > 0 || turn.deletes.length > 0
}

function blockingConflicts(turn: Turn): AiConflict[] {
  return turn.conflicts.filter(conflict => turn.selected[conflict.draftIndex] !== false)
}

const reviewTurn = computed<Turn | null>(() => {
  const turn = activeAssistant.value
  return turn && actionCount(turn) > 0 ? turn : null
})

function reviewNote(turn: Turn): string {
  if (blockingConflicts(turn).length > 0) return "Resolve the conflicts first."
  if (editingIndex.value !== null) return "Save or cancel your edit first."
  return `${selectedCount(turn)} of ${actionCount(turn)} selected`
}

function assistantText(turn: Turn): string {
  if (turn.status === "reading") return "Reading that…"
  if (turn.status === "error") return "I couldn't finish that one."
  if (turn.applied) {
    if (turn.reply) return turn.reply
    if (props.focusEventId) return "Done — the event is updated."
    if (turn.added.length > 0) {
      return `Done — ${turn.added.length === 1 ? "it's" : "they're"} on the calendar.`
    }
    return "Done — the calendar is updated."
  }
  if (turn.outcome === "partial" && (turn.added.length > 0 || actionCount(turn) > 0)) {
    return "Some changes were applied. The rest are still below."
  }
  if (turn.questions.length > 0 && turn.drafts.length === 0) {
    return turn.questions.length === 1
      ? turn.questions[0]!.question
      : `${turn.questions.length} details to confirm.`
  }
  if (turn.reply) return turn.reply
  const count = turn.drafts.length
  const changes = turn.updates.length + turn.deletes.length
  if (count > 0) {
    if (props.focusEventId) {
      return "Here's the updated event. Check the changes, then save."
    }
    return `I found ${count} event${count === 1 ? "" : "s"}. Check the details, then add ${count === 1 ? "it" : "them"} when ready.`
  }
  if (changes > 0) {
    return `I found ${changes} change${changes === 1 ? "" : "s"} to existing events. Review ${changes === 1 ? "it" : "them"}, then apply.`
  }
  return turn.status === "empty"
    ? "I couldn't find a dated event in that. Add a day or time and I'll try again."
    : ""
}

function turnNote(turn: Turn): string {
  if (turn.applied) return ""
  if (!isActive(turn) && actionCount(turn) > 0) {
    if (props.focusEventId) return "This change was not saved."
    if (!hasExistingChanges(turn)) {
      return turn.drafts.length === 1 ? "1 event was not added." : `${turn.drafts.length} events were not added.`
    }
    const total = actionCount(turn)
    return total === 1 ? "1 change was not saved." : `${total} changes were not saved.`
  }
  return ""
}

/**
 * Offer manual entry only when the household actually tried to import
 * something (an image, a document-like message, or rows the model could not
 * turn into events). Used as a fallback for saved conversations from before
 * the model started choosing the turn actions itself.
 */
function offersManualEntry(turn: Turn): boolean {
  if (turn.status !== "empty" || turn.applied || turn.added.length > 0) return false
  if (turn.requestImage) return true
  if (turn.warnings.length > 0) return true
  return turn.documentKind !== "" && turn.documentKind !== "other"
}

const TURN_ACTION_IDS = new Set(["add_manually", "add_another", "done"])

function legacyActions(turn: Turn): string[] {
  if (turn.applied) {
    return turn.added.length > 0 ? ["done", "add_another"] : ["done"]
  }
  return offersManualEntry(turn) ? ["add_manually"] : []
}

/**
 * The buttons the model chose for this turn, filtered against the live state.
 * The model owns the choice; the harness only hides actions that cannot work
 * yet (for example "add_another" before anything was saved).
 */
function visibleActions(turn: Turn): string[] {
  const source = turn.actionsDeclared ? turn.actions : legacyActions(turn)
  const visible: string[] = []
  for (const action of source) {
    if (!TURN_ACTION_IDS.has(action) || visible.includes(action)) continue
    if (props.focusEventId && action !== "done") continue
    if (action === "done" && !turn.applied) continue
    if (action === "add_another" && (!turn.applied || turn.added.length === 0)) continue
    if (action === "add_manually" && (turn.applied || actionCount(turn) > 0)) continue
    visible.push(action)
  }
  return visible
}

function formatSpan(startAt: string, endAt: string | null, allDay: boolean): string {
  const date = new Date(startAt)
  if (Number.isNaN(date.getTime())) return "Date unknown"
  const day = date.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })
  const end = endAt ? new Date(endAt) : null
  const validEnd = end && !Number.isNaN(end.getTime()) ? end : null
  const endDay = validEnd
    ? validEnd.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })
    : ""
  const spansDays = !!validEnd && dateInputValue(validEnd.toISOString()) !== dateInputValue(startAt)

  if (allDay) {
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

function formatWhen(draft: AiDraft): string {
  return formatSpan(draft.startAt, draft.endAt, draft.allDay)
}

function whenChanged(update: AiEventUpdate): boolean {
  const changes = update.changes
  return (
    changes.start_at !== undefined ||
    changes.end_at !== undefined ||
    changes.all_day !== undefined
  )
}

function updateDiff(update: AiEventUpdate): string[] {
  const changes = update.changes
  const lines: string[] = []
  if (changes.title !== undefined) {
    lines.push(`Title: ${update.before.title} → ${changes.title}`)
  }
  if (whenChanged(update)) {
    lines.push(
      `When: ${formatSpan(update.before.start_at, update.before.end_at, update.before.all_day)} → `
      + formatSpan(update.after.start_at, update.after.end_at, update.after.all_day),
    )
  }
  if (changes.reminder_minutes !== undefined) {
    lines.push(
      changes.reminder_minutes == null
        ? "Reminder removed"
        : `Reminder ${reminderLabel(changes.reminder_minutes)?.toLowerCase() ?? "changed"}`,
    )
  }
  if (changes.recurrence !== undefined) {
    const label = changes.recurrence?.freq
      ? RECUR_LABELS[changes.recurrence.freq] ?? changes.recurrence.freq
      : null
    lines.push(label ? `Repeats ${label}` : "No longer repeats")
  }
  if (changes.assignee_id !== undefined) {
    const name = changes.assignee_id ? props.memberNames?.[changes.assignee_id] : ""
    lines.push(name ? `Assigned to ${name}` : "Unassigned")
  }
  if (changes.description !== undefined) lines.push("Notes updated")
  return lines
}

const RECUR_LABELS: Record<string, string> = {
  daily: "daily",
  weekly: "weekly",
  biweekly: "every 2 weeks",
  monthly: "monthly",
  yearly: "yearly",
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

// ── Status ────────────────────────────────────────────────────────────────
onMounted(() => {
  void loadStatus()
  if (props.conversationId) {
    void loadConversation(props.conversationId)
  } else {
    seedEventChat()
  }
  nextTick(() => resizeComposer())
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
    nextTick(() => {
      resizeComposer()
      composerEl.value?.focus()
    })
  }
}

function restoredTurn(stored: AiConversationTurn): Turn {
  if (stored.role === "user") {
    const turn = userTurn(stored.text, null)
    turn.imageName = stored.imageName
    turn.imageUrl = stored.imageUrl
    return turn
  }
  const turn = assistantTurn()
  turn.reply = stored.reply
  turn.rawResponse = stored.rawResponse
  turn.documentKind = stored.documentKind
  turn.actions = stored.actions
  turn.actionsDeclared = stored.actionsDeclared
  turn.drafts = props.focusEventId ? stored.drafts.slice(0, 1) : stored.drafts
  turn.selected = turn.drafts.map(() => true)
  turn.updates = props.focusEventId ? [] : stored.updates ?? []
  turn.updateSelected = turn.updates.map(() => true)
  turn.deletes = props.focusEventId ? [] : stored.deletes ?? []
  turn.deleteSelected = turn.deletes.map(() => true)
  turn.added = stored.added
  turn.questions = stored.questions
  turn.warnings = stored.warnings
  turn.applied = stored.applied
  turn.outcome = stored.outcome
  turn.status = actionCount(turn) > 0 || turn.questions.length > 0 || turn.applied
    ? "ready"
    : "empty"
  return turn
}

function seedEventChat() {
  if (props.conversationId || !props.focusEventId || turns.value.length > 0) return
  const source = (props.focusSourceMessage ?? focusEvent.value?.sourceMessage ?? "").trim()
  if (!source) return
  turns.value.push(userTurn(source.slice(0, 20_000), null))
  seededSource.value = true
}

async function loadConversation(id: string) {
  loadingConversation.value = true
  conversationError.value = ""
  try {
    const conversation = await aiApi.getConversation(id)
    conversationId.value = conversation.id
    turns.value = conversation.turns.map(restoredTurn)
    for (const turn of turns.value) seedDatetimeAnswers(turn)
    await nextTick()
    void scrollToBottom()
    void nextTick(() => composerEl.value?.focus())
  } catch (error) {
    conversationError.value = error instanceof Error
      ? error.message
      : "Couldn't load that conversation."
  } finally {
    loadingConversation.value = false
  }
}

function retryConversation() {
  if (props.conversationId) void loadConversation(props.conversationId)
}

function conversationTitle(): string {
  const first = turns.value.find(turn => turn.role === "user" && turn.text.trim())
  return (first?.text ?? "Smart import").trim().slice(0, 200)
}

function conversationTurns(): AiConversationTurn[] {
  return turns.value.slice(-40).map(turn => ({
    role: turn.role,
    text: turn.role === "user" ? turn.text : turn.reply,
    imageName: turn.imageName,
    imageUrl: turn.imageUrl,
    rawResponse: turn.rawResponse,
    reply: turn.reply,
    drafts: turn.drafts,
    added: turn.added,
    updates: turn.updates,
    deletes: turn.deletes,
    questions: turn.questions,
    warnings: turn.warnings,
    applied: turn.applied,
    outcome: turn.outcome,
    documentKind: turn.documentKind,
    actions: turn.actions,
    actionsDeclared: turn.actionsDeclared,
  }))
}

async function persistConversation(): Promise<string> {
  const payload = {
    title: conversationTitle(),
    turns: conversationTurns(),
  }
  const saved = conversationId.value
    ? await aiApi.updateConversation(conversationId.value, payload)
    : await aiApi.createConversation(payload)
  conversationId.value = saved.id
  return saved.id
}

function queueConversationSave() {
  if (turns.value.length === 0) return
  // Serialise saves so a second turn cannot create a duplicate conversation
  // while the first create is still in flight.
  const save = saveChain.catch(() => "").then(() => persistConversation())
  saveChain = save
  save.catch(() => {
    // Best effort: adding events calls ensureConversation and surfaces a
    // retryable error if the save still fails.
  })
}

async function ensureConversation(): Promise<string> {
  try {
    const id = await saveChain
    if (id) return id
  } catch {
    // Fall through and retry with the latest turns.
  }
  return persistConversation()
}

/**
 * Keep the attached screenshot with the saved conversation.
 *
 * The server re-encodes it and hands back a URL, which is all the transcript
 * stores. A failure here only costs the saved chat its picture (the filename
 * still shows), so it never interrupts the import.
 */
async function storeImage(turn: Turn, image: Attachment) {
  try {
    const stored = await aiApi.uploadImage({ image: image.dataUrl, name: image.name })
    if (stored.url) turn.imageUrl = stored.url
  } catch {
    // Best effort: the chat still saves, without the picture.
  }
}

// ── Composer and attachments ──────────────────────────────────────────────
function resizeComposer() {
  const el = composerEl.value
  if (!el) return
  el.style.height = "auto"
  el.style.height = `${Math.min(el.scrollHeight, 144)}px`
}

function onTextInput() {
  void nextTick(() => resizeComposer())
}

function readFile(file: File) {
  inputError.value = ""
  if (!file.type.startsWith("image/")) {
    inputError.value = "Choose a PNG, JPEG, WebP or GIF image."
    return
  }
  if (file.size > 8 * 1024 * 1024) {
    inputError.value = "That image is larger than 8 MB."
    return
  }
  const reader = new FileReader()
  reader.onload = () => {
    pendingImage.value = {
      dataUrl: typeof reader.result === "string" ? reader.result : "",
      name: file.name || "Image",
    }
    void nextTick(() => composerEl.value?.focus())
  }
  reader.onerror = () => { inputError.value = "Could not read that image." }
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
  pendingImage.value = null
  void nextTick(() => composerEl.value?.focus())
}

function openFilePicker() {
  fileInput.value?.click()
}

function onComposerKeydown(event: KeyboardEvent) {
  if (event.key !== "Enter" || event.shiftKey || event.isComposing) return
  event.preventDefault()
  void sendMessage()
}

// ── Chat turns ────────────────────────────────────────────────────────────
function historyText(turn: Turn): string {
  if (turn.rawResponse) return turn.rawResponse
  if (turn.drafts.length > 0) {
    const lines = turn.drafts.map(draft => {
      const when = draft.allDay ? `${draft.startAt} (all day)` : draft.startAt
      return `- ${draft.title} · ${when}`
    })
    return `I proposed these events:\n${lines.join("\n")}`
  }
  if (turn.questions.length > 0) {
    return turn.questions.map(question => question.question).join("\n")
  }
  return ""
}

function buildHistory(source: Turn[]): AiChatMessage[] {
  const messages: AiChatMessage[] = []
  for (const turn of source) {
    if (turn.role === "user") {
      const imageName = turn.image?.name ?? turn.imageName
      const text = imageName
        ? `${turn.text.trim()}\n[Image: ${imageName}]`.trim()
        : turn.text.trim()
      if (text) messages.push({ role: "user", text })
      continue
    }
    const text = historyText(turn)
    if (text.trim()) messages.push({ role: "assistant", text })
  }
  return messages.slice(-20)
}

function conversationSource(): string {
  const parts: string[] = []
  for (const turn of turns.value) {
    if (turn.role !== "user") continue
    if (turn.text.trim()) parts.push(turn.text.trim())
    const imageName = turn.image?.name ?? turn.imageName
    if (imageName) parts.push(`[Image: ${imageName}]`)
  }
  const source = parts.join("\n\n") || "Imported with Smart import."
  return source.length > 20_000 ? `${source.slice(0, 19_990)}…` : source
}

async function scrollToBottom() {
  await nextTick()
  const el = transcriptEl.value
  if (el) el.scrollTop = el.scrollHeight
}

/** Land on the start of the new answer, not the end of a long draft card. */
async function revealLatestAssistant() {
  await nextTick()
  const scroller = transcriptEl.value
  if (!scroller) return
  const messages = scroller.querySelectorAll<HTMLElement>(".ai-msg--assistant")
  const latest = messages[messages.length - 1]
  if (latest) {
    const top = latest.getBoundingClientRect().top - scroller.getBoundingClientRect().top
    scroller.scrollTop = Math.max(0, scroller.scrollTop + top - 4)
  }
}

function applyParseResult(turn: Turn, result: AiParseResult): AiDraft[] {
  const resultEvents = props.focusEventId
    ? result.events.slice(0, 1)
    : result.events
  turn.reply = result.reply
  turn.drafts = resultEvents
  turn.selected = resultEvents.map(() => true)
  turn.updates = props.focusEventId ? [] : result.updates
  turn.updateSelected = turn.updates.map(() => true)
  turn.deletes = props.focusEventId ? [] : result.deletes
  turn.deleteSelected = turn.deletes.map(() => true)
  turn.warnings = result.skipped > 0
    ? [
        ...result.warnings,
        `${result.skipped} ${result.skipped === 1 ? "entry" : "entries"} couldn't be turned into an event.`,
      ]
    : result.warnings
  turn.questions = result.questions
  turn.conflicts = result.conflicts
  turn.rawResponse = result.response
  turn.reasoning = turn.reasoning || result.reasoning || ""
  turn.documentKind = result.documentKind
  turn.actions = result.actions
  turn.actionsDeclared = true
  turn.status = actionCount(turn) > 0 || result.questions.length > 0 ? "ready" : "empty"
  seedDatetimeAnswers(turn)
  const changed = turn.updates.length + turn.deletes.length
  announcement.value = resultEvents.length > 0
    ? `${resultEvents.length} event${resultEvents.length === 1 ? "" : "s"} ready.`
    : changed > 0
      ? `${changed} calendar change${changed === 1 ? "" : "s"} ready.`
      : result.questions.length > 0
        ? "I need one more detail."
        : "No events found."
  return resultEvents
}

async function sendMessage(
  text = composerText.value.trim(),
  image = pendingImage.value,
  answers: AiClarification[] = [],
) {
  if (parsing.value || applying.value || !configured.value) return
  if (!text.trim() && !image) return

  const message = text.trim()
  const user = userTurn(message, image)
  const assistant = assistantTurn(message, image)
  assistant.clarifications = [...clarifications.value, ...answers]
  if (answers.length > 0) clarifications.value.push(...answers)
  turns.value.push(user, assistant)
  // Push then read back the reactive proxy: mutating the raw object would
  // update the state without triggering the transcript to re-render.
  const liveAssistant = turns.value[turns.value.length - 1]!
  const liveUser = turns.value[turns.value.length - 2]!
  // Runs alongside the parse, so storing the picture never delays the reply.
  const storedImage = image ? storeImage(liveUser, image) : null
  composerText.value = ""
  pendingImage.value = null
  inputError.value = ""
  parsing.value = true
  announcement.value = "Reading your message."
  void nextTick(() => {
    resizeComposer()
    void scrollToBottom()
  })

  const history = buildHistory(turns.value.slice(0, -2))
  try {
    const result = await parseStream(
      {
        text: message,
        image: image?.dataUrl ?? null,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        clarifications: liveAssistant.clarifications,
        history,
        focusEventId: props.focusEventId ?? null,
      },
      {
        onReasoning: chunk => {
          liveAssistant.reasoning += chunk
          void scrollToBottom()
        },
      },
    )
    applyParseResult(liveAssistant, result)
    if (storedImage) await storedImage
    queueConversationSave()
  } catch (error) {
    liveAssistant.status = "error"
    liveAssistant.error = error instanceof Error ? error.message : "Could not read that message."
    announcement.value = "Something went wrong."
  } finally {
    parsing.value = false
    void revealLatestAssistant()
    void nextTick(() => composerEl.value?.focus())
  }
}

async function answerQuestion(turn: Turn, question: AiQuestion, option: string) {
  if (!isActive(turn) || parsing.value) return
  await sendMessage(option, null, [{ question: question.question, answer: option }])
}

function datetimeAnswer(turn: Turn, question: AiQuestion) {
  // Seeded by applyParseResult/loadConversation before the picker renders.
  return datetimeAnswers.value[`${turn.id}:${question.id}`]!
}

function seedDatetimeAnswers(turn: Turn) {
  for (const question of turn.questions) {
    if (question.kind !== "datetime") continue
    const key = `${turn.id}:${question.id}`
    if (!datetimeAnswers.value[key]) {
      datetimeAnswers.value[key] = { date: "", time: "" }
    }
  }
}

function datetimeReady(turn: Turn, question: AiQuestion): boolean {
  const answer = datetimeAnswer(turn, question)
  return !!answer.date && !!answer.time
}

function formatDatetimeAnswer(date: string, time: string): string {
  const [year, month, day] = date.split("-").map(Number)
  const moment = new Date(year, month - 1, day)
  if (Number.isNaN(moment.getTime())) return date
  const dayLabel = moment.toLocaleDateString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  })
  if (time === "all-day") return `${dayLabel} · All day`
  const [hours, minutes] = time.split(":").map(Number)
  const clock = new Date(2000, 0, 1, hours, minutes)
  return `${dayLabel} at ${clock.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
}

async function answerDatetime(turn: Turn, question: AiQuestion) {
  if (!isActive(turn) || parsing.value || applying.value) return
  const answer = datetimeAnswer(turn, question)
  if (!answer.date || !answer.time) return
  const label = formatDatetimeAnswer(answer.date, answer.time)
  await sendMessage(label, null, [{ question: question.question, answer: label }])
}

async function retry(turn: Turn) {
  if (parsing.value) return
  const index = turns.value.findIndex(item => item.id === turn.id)
  const user = index > 0 ? turns.value[index - 1] : null
  if (!user || user.role !== "user") return
  turns.value.splice(index, 1)
  const assistant = assistantTurn(user.text, user.image)
  assistant.clarifications = turn.clarifications
  turns.value.push(assistant)
  const liveAssistant = turns.value[turns.value.length - 1]!
  parsing.value = true
  announcement.value = "Trying again."
  const history = buildHistory(turns.value.slice(0, Math.max(0, index - 1)))
  try {
    const result = await parseStream(
      {
        text: user.text,
        image: user.image?.dataUrl ?? null,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        clarifications: liveAssistant.clarifications,
        history,
        focusEventId: props.focusEventId ?? null,
      },
      {
        onReasoning: chunk => {
          liveAssistant.reasoning += chunk
          void scrollToBottom()
        },
      },
    )
    applyParseResult(liveAssistant, result)
    queueConversationSave()
  } catch (error) {
    liveAssistant.status = "error"
    liveAssistant.error = error instanceof Error ? error.message : "Could not read that message."
    announcement.value = "Something went wrong."
  } finally {
    parsing.value = false
    void revealLatestAssistant()
  }
}

function startOver() {
  turns.value = []
  composerText.value = ""
  pendingImage.value = null
  clarifications.value = []
  inputError.value = ""
  announcement.value = ""
  conversationId.value = ""
  conversationError.value = ""
  saveChain = Promise.resolve("")
  editingIndex.value = null
  editBuffer.value = null
  void nextTick(() => {
    resizeComposer()
    composerEl.value?.focus()
  })
}

function totalAdded(): number {
  return turns.value.reduce((count, turn) => count + turn.added.length, 0)
}

function finish() {
  emit("done", totalAdded())
}

// ── Draft selection and saving ────────────────────────────────────────────
function toggle(turn: Turn, index: number) {
  turn.selected[index] = !turn.selected[index]
}

function toggleAll(turn: Turn) {
  const next = selectedCount(turn) !== actionCount(turn)
  turn.selected = turn.drafts.map(() => next)
  turn.updateSelected = turn.updates.map(() => next)
  turn.deleteSelected = turn.deletes.map(() => next)
}

function toggleUpdate(turn: Turn, index: number) {
  turn.updateSelected[index] = !turn.updateSelected[index]
}

function toggleDelete(turn: Turn, index: number) {
  turn.deleteSelected[index] = !turn.deleteSelected[index]
}

async function applySelected() {
  const turn = activeAssistant.value
  if (!turn || applying.value || selectedCount(turn) === 0 || editingIndex.value !== null) return
  if (blockingConflicts(turn).length > 0) return
  applying.value = true
  inputError.value = ""
  turn.failed = 0
  turn.outcome = null
  turn.conflicts = []
  const saved: AiDraft[] = []
  const failedDrafts: AiDraft[] = []
  const savedUpdates = new Set<number>()
  const savedDeletes = new Set<number>()
  const hadExistingChanges = hasExistingChanges(turn)
  let failedActions = 0
  const deletedEventIds = new Set<string>()
  const sourceMessage = conversationSource()
  try {
    let linkedConversationId = conversationId.value
    if (turn.selected.some(Boolean)) {
      try {
        linkedConversationId = await ensureConversation()
      } catch {
        inputError.value = "Couldn't save this conversation. Try again before saving the event."
        return
      }
    }

    if (props.focusEventId) {
      const index = turn.selected.findIndex(Boolean)
      const draft = index >= 0 ? turn.drafts[index] : null
      if (!draft) return
      try {
        const updated = await calendarApi.updateEvent(props.focusEventId, {
          title: draft.title,
          description: draft.description,
          source_message: sourceMessage,
          ...(linkedConversationId
            ? { ai_conversation_id: linkedConversationId }
            : {}),
          start_at: draft.startAt,
          end_at: draft.endAt ?? null,
          all_day: draft.allDay,
          recurrence: draft.recurrence,
          reminder_minutes: draft.reminderMinutes,
          assignee_id: draft.assigneeId,
        })
        upsertEvent(updated)
        saved.push(draft)
        await removeReplacedEvents(turn, index, deletedEventIds)
      } catch {
        failedDrafts.push(draft)
      }
    } else {
      const calendarId = turn.selected.some(Boolean)
        ? await ensureDefaultCalendar()
        : ""
      for (const [index, draft] of turn.drafts.entries()) {
        if (!turn.selected[index]) continue
        try {
          const event = await calendarApi.createEvent({
            calendar_id: calendarId,
            title: draft.title,
            description: draft.description,
            source_message: sourceMessage,
            ai_conversation_id: linkedConversationId,
            start_at: draft.startAt,
            end_at: draft.endAt ?? undefined,
            all_day: draft.allDay,
            recurrence: draft.recurrence,
            reminder_minutes: draft.reminderMinutes,
            assignee_id: draft.assigneeId,
          })
          upsertEvent(event)
          saved.push(draft)
          await removeReplacedEvents(turn, index, deletedEventIds)
        } catch {
          failedDrafts.push(draft)
        }
      }
    }

    for (const [index, update] of turn.updates.entries()) {
      if (props.focusEventId || !turn.updateSelected[index]) continue
      if (deletedEventIds.has(update.eventId)) {
        savedUpdates.add(update.ref)
        continue
      }
      try {
        const updated = await calendarApi.updateEvent(update.eventId, update.changes)
        upsertEvent(updated)
        savedUpdates.add(update.ref)
      } catch {
        failedActions += 1
      }
    }

    for (const [index, removal] of turn.deletes.entries()) {
      if (props.focusEventId || !turn.deleteSelected[index]) continue
      try {
        await calendarApi.deleteEvent(removal.eventId)
        removeEvent(removal.eventId)
        deletedEventIds.add(removal.eventId)
        savedDeletes.add(removal.ref)
      } catch {
        failedActions += 1
      }
    }
  } finally {
    applying.value = false
  }

  const savedActions = savedUpdates.size + savedDeletes.size
  turn.failed = failedDrafts.length + failedActions
  if (saved.length > 0) {
    turn.added = props.focusEventId ? saved : [...turn.added, ...saved]
  }
  turn.updates = props.focusEventId
    ? []
    : turn.updates.filter(update => !savedUpdates.has(update.ref))
  turn.updateSelected = turn.updates.map(() => true)
  turn.deletes = props.focusEventId
    ? []
    : turn.deletes.filter(removal => !savedDeletes.has(removal.ref))
  turn.deleteSelected = turn.deletes.map(() => true)

  const failedTotal = failedDrafts.length + failedActions
  if (failedTotal === 0) {
    turn.outcome = "success"
    turn.applied = true
    turn.reply = ""
    turn.drafts = []
    turn.selected = []
    turn.updates = []
    turn.updateSelected = []
    turn.deletes = []
    turn.deleteSelected = []
    turn.replacements = []
  } else {
    turn.outcome = saved.length > 0 || savedActions > 0 ? "partial" : "failed"
    turn.drafts = failedDrafts
    turn.selected = failedDrafts.map(() => true)
  }
  editingIndex.value = null
  editBuffer.value = null
  const appliedTotal = saved.length + savedActions
  announcement.value = appliedTotal > 0
    ? props.focusEventId
      ? "Event updated."
      : hadExistingChanges
        ? `Applied ${appliedTotal} calendar change${appliedTotal === 1 ? "" : "s"}.`
        : `Added ${saved.length} event${saved.length === 1 ? "" : "s"}.`
    : props.focusEventId
      ? "The event was not updated."
      : hadExistingChanges
        ? "No changes were applied."
        : "No events were added."
  queueConversationSave()
  void revealLatestAssistant()
}

/** Apply one reviewed change without touching the rest of the batch. */
async function applyUpdate(turn: Turn, index: number) {
  const update = turn.updates[index]
  if (!update || applying.value) return
  applying.value = true
  inputError.value = ""
  try {
    const updated = await calendarApi.updateEvent(update.eventId, update.changes)
    upsertEvent(updated)
    turn.updates.splice(index, 1)
    turn.updateSelected.splice(index, 1)
    announcement.value = `Updated ${update.title}.`
    if (actionCount(turn) === 0) {
      turn.outcome = "success"
      turn.applied = true
      turn.reply = ""
    }
    queueConversationSave()
  } catch {
    inputError.value = `Couldn't update "${update.title}". Try again.`
  } finally {
    applying.value = false
  }
}

/** Delete one reviewed event without touching the rest of the batch. */
async function applyDelete(turn: Turn, index: number) {
  const removal = turn.deletes[index]
  if (!removal || applying.value) return
  applying.value = true
  inputError.value = ""
  try {
    await calendarApi.deleteEvent(removal.eventId)
    removeEvent(removal.eventId)
    turn.deletes.splice(index, 1)
    turn.deleteSelected.splice(index, 1)
    announcement.value = `Deleted ${removal.title}.`
    if (actionCount(turn) === 0) {
      turn.outcome = "success"
      turn.applied = true
      turn.reply = ""
    }
    queueConversationSave()
  } catch {
    inputError.value = `Couldn't delete "${removal.title}". Try again.`
  } finally {
    applying.value = false
  }
}

// ── Inline draft editing ──────────────────────────────────────────────────
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

watch(
  () => activeAssistant.value?.id,
  () => {
    editingIndex.value = null
    editBuffer.value = null
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
  const turn = activeAssistant.value
  const draft = turn?.drafts[index]
  if (!turn || !draft) return
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
  void nextTick(() => {
    const item = rootEl.value?.querySelector<HTMLElement>(".ai-item--editing")
    if (item && typeof item.scrollIntoView === "function") item.scrollIntoView({ block: "nearest" })
    rootEl.value?.querySelector<HTMLInputElement>(".ai-item--editing .ai-edit-title")
      ?.focus({ preventScroll: true })
  })
}

function cancelEdit() {
  const index = editingIndex.value
  editingIndex.value = null
  editBuffer.value = null
  if (index === null) return
  void nextTick(() => {
    rootEl.value?.querySelectorAll<HTMLButtonElement>(".ai-item-edit")[index]?.focus()
  })
}

function saveEdit() {
  const index = editingIndex.value
  const buffer = editBuffer.value
  const turn = activeAssistant.value
  const draft = index === null ? null : turn?.drafts[index]
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
  // Moving the draft resolves the conflict on its own; don't remove the old
  // event after all.
  if (turn) {
    turn.replacements = turn.replacements.filter(item => item.draftIndex !== index)
  }
  cancelEdit()
}

function dismissConflict(turn: Turn, id: string) {
  turn.conflicts = turn.conflicts.filter(conflict => conflict.id !== id)
}

function editConflict(turn: Turn, conflict: AiConflict) {
  dismissConflict(turn, conflict.id)
  openEditor(conflict.draftIndex)
}

function replaceConflict(turn: Turn, conflict: AiConflict) {
  if (conflict.existingKind !== "existing" || !conflict.existingEventId) return
  if (!turn.replacements.some(item => item.id === conflict.id)) {
    turn.replacements.push(conflict)
  }
  dismissConflict(turn, conflict.id)
}

function undoReplacement(turn: Turn, index: number) {
  const [conflict] = turn.replacements.splice(index, 1)
  if (conflict) turn.conflicts = [...turn.conflicts, conflict]
}

async function removeReplacedEvents(
  turn: Turn,
  draftIndex: number,
  deleted: Set<string>,
) {
  const replacements = turn.replacements.filter(
    item => item.draftIndex === draftIndex && item.existingEventId,
  )
  for (const replacement of replacements) {
    const eventId = replacement.existingEventId!
    if (deleted.has(eventId)) {
      turn.replacements = turn.replacements.filter(item => item.id !== replacement.id)
      continue
    }
    try {
      await calendarApi.deleteEvent(eventId)
      deleted.add(eventId)
      removeEvent(eventId)
      turn.replacements = turn.replacements.filter(item => item.id !== replacement.id)
    } catch {
      inputError.value = `Added the new event, but couldn't remove "${replacement.existingTitle}". Remove it from the calendar if needed.`
    }
  }
}

function outcomeMessage(turn: Turn): string {
  if (props.focusEventId) {
    if (turn.outcome === "failed") return "The event wasn't updated."
    return "Event updated."
  }
  if (turn.outcome === "partial") {
    const applied = turn.added.length
    if (!hasExistingChanges(turn)) {
      return `Added ${applied} event${applied === 1 ? "" : "s"}. ${turn.failed} couldn't be saved.`
    }
    return `Added ${applied} event${applied === 1 ? "" : "s"}. ${turn.failed} change${turn.failed === 1 ? "" : "s"} couldn't be saved.`
  }
  return hasExistingChanges(turn) ? "No changes were applied." : "No events were added."
}
</script>

<template>
  <div
    ref="rootEl"
    class="ai-import"
    :class="{ 'ai-import--dragging': dragging }"
    @paste="onPaste"
    @dragover.prevent="dragging = true"
    @dragleave.prevent="dragging = false"
    @drop.prevent="onDrop"
  >
    <span class="ai-sr-only" aria-live="polite">{{ announcement }}</span>

    <div v-if="statusLoading" class="ai-skeleton" role="status" aria-label="Checking Smart import">
      <span class="ai-skeleton-line ai-skeleton-line--wide" />
      <span class="ai-skeleton-line" />
      <span class="ai-skeleton-line ai-skeleton-line--short" />
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
          Add an OpenCode API key in Settings → Smart import to turn a message
          or photo into calendar events.
        </p>
      </div>
      <UiButton size="sm" variant="ghost" @click="loadStatus">Check again</UiButton>
    </div>

    <template v-else>
      <div v-if="hasConversation" class="ai-chat-head">
        <span class="ai-chat-label">
          <PhChatCircleDots :size="18" aria-hidden="true" />
          Schedule chat
        </span>
        <button v-if="!focusEventId" type="button" class="ai-new-chat" @click="startOver">
          <PhPlus :size="16" weight="bold" aria-hidden="true" />
          New chat
        </button>
      </div>

      <div v-if="focusEventId" class="ai-focus">
        <PhPencilSimple :size="16" aria-hidden="true" />
        <span>
          Updating
          <strong>{{ focusEvent?.title ?? focusEventTitle ?? "this event" }}</strong>
        </span>
      </div>

      <div
        ref="transcriptEl"
        class="ai-chat"
        :class="{ 'ai-chat--empty': !hasConversation }"
        role="log"
        aria-label="Schedule chat"
      >
        <div v-if="loadingConversation" class="ai-chat-loading" role="status">
          <span class="ai-skeleton-line ai-skeleton-line--wide" />
          <span class="ai-skeleton-line" />
          <span class="ai-skeleton-line ai-skeleton-line--short" />
          <span class="ai-sr-only">Loading conversation</span>
        </div>

        <div v-else-if="conversationError" class="ai-callout ai-callout--danger" role="alert">
          <PhWarning :size="18" weight="fill" class="ai-callout-icon" aria-hidden="true" />
          <div class="ai-callout-copy">
            <p class="ai-callout-title">Couldn't open this conversation</p>
            <p class="ai-callout-text">{{ conversationError }}</p>
          </div>
          <UiButton size="sm" variant="ghost" @click="retryConversation">Try again</UiButton>
        </div>

        <div v-else-if="!hasConversation && focusEventId" class="ai-welcome">
          <div class="ai-welcome-head">
            <span class="ai-welcome-mark" aria-hidden="true">
              <PhPencilSimple :size="22" weight="fill" />
            </span>
            <h4 class="ai-welcome-title">No chat history for this event</h4>
          </div>
          <p class="ai-welcome-copy">
            You can still tell me what to change. The event's current details
            are loaded, and I'll update them when you save.
          </p>
        </div>

        <div v-else-if="!hasConversation" class="ai-welcome">
          <div class="ai-welcome-head">
            <span class="ai-welcome-mark" aria-hidden="true">
              <PhSparkle :size="24" weight="fill" />
            </span>
            <h4 class="ai-welcome-title">What's on the schedule?</h4>
          </div>
          <p class="ai-welcome-copy">
            Tell me in your own words, or add a photo of a school letter,
            invitation or calendar. I'll turn it into events you can check.
          </p>
        </div>

        <div v-else class="ai-log">
          <div v-if="seedNotice" class="ai-seed-note" role="status">
            <PhChatCircleDots :size="16" aria-hidden="true" />
            <p>{{ seedNotice }}</p>
          </div>
          <article
            v-for="turn in turns"
            :key="turn.id"
            class="ai-msg"
            :class="turn.role === 'user' ? 'ai-msg--user' : 'ai-msg--assistant'"
          >
            <template v-if="turn.role === 'user'">
              <div class="ai-bubble">
                <p v-if="turn.text" class="ai-bubble-text">{{ turn.text }}</p>
                <img
                  v-if="turn.image"
                  :src="turn.image.dataUrl"
                  :alt="turn.image.name || 'Attached image'"
                  class="ai-bubble-image"
                />
                <img
                  v-else-if="turn.imageUrl"
                  :src="turn.imageUrl"
                  :alt="turn.imageName || 'Attached image'"
                  class="ai-bubble-image"
                  loading="lazy"
                  decoding="async"
                />
                <p v-if="turn.imageName" class="ai-bubble-file">{{ turn.imageName }}</p>
              </div>
            </template>

            <template v-else>
              <span class="ai-avatar" aria-hidden="true">
                <PhSparkle :size="15" weight="fill" />
              </span>
              <div class="ai-msg-body">
                <p class="ai-msg-text">{{ assistantText(turn) }}</p>

                <div v-if="turn.status === 'reading'" class="ai-typing" role="status">
                  <span class="ai-typing-dot" />
                  <span class="ai-typing-dot" />
                  <span class="ai-typing-dot" />
                  <span class="ai-sr-only">Working on it</span>
                </div>

                <div v-if="turn.status === 'error'" class="ai-error" role="alert">
                  <PhWarning :size="16" weight="fill" class="ai-error-icon" aria-hidden="true" />
                  <span>{{ turn.error }}</span>
                </div>

                <div
                  v-if="isActive(turn) && turn.questions.length > 0 && turn.status === 'ready'"
                  class="ai-questions"
                >
                  <div v-for="question in turn.questions" :key="question.id" class="ai-question">
                    <p
                      v-if="turn.questions.length > 1 || actionCount(turn) > 0"
                      class="ai-question-text"
                    >
                      {{ question.question }}
                    </p>

                    <div v-if="question.kind === 'datetime'" class="ai-datetime">
                      <div class="ai-datetime-row">
                        <div class="ai-datetime-field">
                          <label
                            :for="`${uid}-${turn.id}-${question.id}-date`"
                            class="ai-datetime-label"
                          >
                            Date
                          </label>
                          <UiInput
                            :id="`${uid}-${turn.id}-${question.id}-date`"
                            v-model="datetimeAnswer(turn, question).date"
                            type="date"
                            :min="todayIso"
                          />
                        </div>
                        <div class="ai-datetime-field">
                          <label
                            :for="`${uid}-${turn.id}-${question.id}-time`"
                            class="ai-datetime-label"
                          >
                            Time
                          </label>
                          <UiSelect
                            :id="`${uid}-${turn.id}-${question.id}-time`"
                            v-model="datetimeAnswer(turn, question).time"
                          >
                            <option value="">Choose a time</option>
                            <option value="all-day">All day</option>
                            <option v-for="slot in TIME_SLOTS" :key="slot.value" :value="slot.value">
                              {{ slot.label }}
                            </option>
                          </UiSelect>
                        </div>
                      </div>
                      <UiButton
                        size="sm"
                        :disabled="!datetimeReady(turn, question) || parsing || applying"
                        @click="answerDatetime(turn, question)"
                      >
                        Confirm date and time
                      </UiButton>
                    </div>

                    <div v-else-if="question.options.length" class="ai-quick-replies">
                      <button
                        v-for="option in question.options"
                        :key="option"
                        type="button"
                        class="ai-quick-reply"
                        :disabled="parsing || applying"
                        @click="answerQuestion(turn, question, option)"
                      >
                        {{ option }}
                      </button>
                    </div>
                  </div>
                </div>

                <div v-if="turn.status === 'error'" class="ai-msg-actions">
                  <UiButton size="sm" variant="ghost" @click="retry(turn)">Try again</UiButton>
                </div>

                <div
                  v-if="turn.warnings.length > 0 && actionCount(turn) === 0"
                  class="ai-callout ai-callout--warning"
                >
                  <PhWarning :size="18" weight="fill" class="ai-callout-icon" aria-hidden="true" />
                  <div class="ai-callout-copy">
                    <p class="ai-callout-title">Worth checking</p>
                    <ul class="ai-warnings">
                      <li v-for="note in turn.warnings" :key="note">{{ note }}</li>
                    </ul>
                  </div>
                </div>

                <!-- Generated drafts and existing-event changes, confirmed before writing -->
                <div
                  v-if="isActive(turn) && actionCount(turn) > 0"
                  class="ai-confirm"
                >
                  <div class="ai-confirm-head">
                    <div>
                      <h4 class="ai-confirm-title">
                        {{ focusEventId
                          ? "Updated event ready"
                          : `${actionCount(turn)} ${actionCount(turn) === 1 ? "change" : "changes"} ready` }}
                      </h4>
                      <p class="ai-confirm-sub">
                        {{ focusEventId
                          ? "Check the changes, then save the event."
                          : "Uncheck anything you don't want, review each item, or apply all." }}
                      </p>
                    </div>
                    <button
                      v-if="!focusEventId"
                      type="button"
                      class="ai-select-all"
                      @click="toggleAll(turn)"
                    >
                      {{ selectedCount(turn) === actionCount(turn) ? "Select none" : "Select all" }}
                    </button>
                  </div>

                  <div
                    v-if="turn.outcome && turn.outcome !== 'success'"
                    class="ai-callout"
                    :class="turn.outcome === 'failed' ? 'ai-callout--danger' : 'ai-callout--warning'"
                    role="status"
                  >
                    <PhWarning :size="18" weight="fill" class="ai-callout-icon" aria-hidden="true" />
                    <div class="ai-callout-copy">
                      <p class="ai-callout-title">{{ outcomeMessage(turn) }}</p>
                      <p class="ai-callout-text">The events below still need saving. Try again when you're ready.</p>
                    </div>
                  </div>

                  <div v-if="blockingConflicts(turn).length > 0" class="ai-callout ai-callout--warning" role="alert">
                    <PhWarning :size="18" weight="fill" class="ai-callout-icon" aria-hidden="true" />
                    <div class="ai-callout-copy">
                      <p class="ai-callout-title">
                        {{ blockingConflicts(turn).length === 1 ? "Schedule conflict" : "Schedule conflicts" }}
                      </p>
                      <p class="ai-callout-text">These events overlap another event. Choose what to do.</p>
                      <ul class="ai-conflicts">
                        <li v-for="conflict in blockingConflicts(turn)" :key="conflict.id" class="ai-conflict">
                          <p class="ai-conflict-text">{{ conflict.message }}</p>
                          <div class="ai-conflict-actions">
                            <UiButton
                              v-if="conflict.existingKind === 'existing' && conflict.existingEventId"
                              size="sm"
                              variant="ghost"
                              @click="replaceConflict(turn, conflict)"
                            >
                              {{ conflict.existingRecurring ? "Replace series" : "Replace existing" }}
                            </UiButton>
                            <UiButton size="sm" variant="ghost" @click="editConflict(turn, conflict)">
                              Change time
                            </UiButton>
                            <UiButton size="sm" variant="ghost" @click="dismissConflict(turn, conflict.id)">
                              Keep both
                            </UiButton>
                          </div>
                        </li>
                      </ul>
                    </div>
                  </div>

                  <div v-if="turn.replacements.length > 0" class="ai-replacements">
                    <p class="ai-replacements-title">Will be removed when saved</p>
                    <ul class="ai-replacements-list">
                      <li
                        v-for="(replacement, index) in turn.replacements"
                        :key="replacement.id"
                        class="ai-replacement"
                      >
                        <span class="ai-replacement-name">{{ replacement.existingTitle }}</span>
                        <button
                          type="button"
                          class="ai-replacement-undo"
                          @click="undoReplacement(turn, index)"
                        >
                          Keep it
                        </button>
                      </li>
                    </ul>
                  </div>

                  <div v-if="turn.warnings.length" class="ai-callout ai-callout--warning">
                    <PhWarning :size="18" weight="fill" class="ai-callout-icon" aria-hidden="true" />
                    <div class="ai-callout-copy">
                      <p class="ai-callout-title">Worth checking</p>
                      <ul class="ai-warnings">
                        <li v-for="note in turn.warnings" :key="note">{{ note }}</li>
                      </ul>
                    </div>
                  </div>

                  <ul class="ai-list">
                    <li
                      v-for="(draft, index) in turn.drafts"
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
                          :checked="turn.selected[index]"
                          :aria-label="`Add ${draft.title}`"
                          @change="toggle(turn, index)"
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
                          <UiSelect :id="`${uid}-edit-assignee`" v-model="editBuffer.assigneeId">
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

                  <ul
                    v-if="turn.updates.length"
                    class="ai-actions"
                    aria-label="Changes to existing events"
                  >
                    <li
                      v-for="(update, index) in turn.updates"
                      :key="`update-${update.ref}`"
                      class="ai-action"
                    >
                      <input
                        :id="`${uid}-update-${index}`"
                        type="checkbox"
                        class="ai-checkbox"
                        :checked="turn.updateSelected[index]"
                        :aria-label="`Apply the change to ${update.title}`"
                        @change="toggleUpdate(turn, index)"
                      />
                      <label :for="`${uid}-update-${index}`" class="ai-action-copy">
                        <span class="ai-action-head">
                          <span class="ai-action-kind">Change</span>
                          <span class="ai-action-title">{{ update.title }}</span>
                          <span v-if="update.external" class="ai-action-badge">Imported</span>
                        </span>
                        <span v-if="!updateDiff(update).length" class="ai-action-sub">
                          {{ formatSpan(update.after.start_at, update.after.end_at, update.after.all_day) }}
                        </span>
                        <span
                          v-for="line in updateDiff(update)"
                          :key="line"
                          class="ai-action-sub"
                        >{{ line }}</span>
                      </label>
                      <button
                        type="button"
                        class="ai-action-apply"
                        :disabled="applying"
                        @click="applyUpdate(turn, index)"
                      >
                        Apply
                      </button>
                    </li>
                  </ul>

                  <ul
                    v-if="turn.deletes.length"
                    class="ai-actions ai-actions--danger"
                    aria-label="Events to delete"
                  >
                    <li
                      v-for="(removal, index) in turn.deletes"
                      :key="`delete-${removal.ref}`"
                      class="ai-action"
                    >
                      <input
                        :id="`${uid}-delete-${index}`"
                        type="checkbox"
                        class="ai-checkbox"
                        :checked="turn.deleteSelected[index]"
                        :aria-label="`Delete ${removal.title}`"
                        @change="toggleDelete(turn, index)"
                      />
                      <label :for="`${uid}-delete-${index}`" class="ai-action-copy">
                        <span class="ai-action-head">
                          <span class="ai-action-kind ai-action-kind--danger">Delete</span>
                          <span class="ai-action-title">{{ removal.title }}</span>
                          <span v-if="removal.external" class="ai-action-badge">Imported</span>
                        </span>
                        <span class="ai-action-sub">
                          {{ formatSpan(removal.startAt, removal.endAt, removal.allDay) }}
                        </span>
                        <span v-if="removal.reason" class="ai-action-sub">{{ removal.reason }}</span>
                      </label>
                      <button
                        type="button"
                        class="ai-action-apply ai-action-apply--danger"
                        :disabled="applying"
                        @click="applyDelete(turn, index)"
                      >
                        Delete
                      </button>
                    </li>
                  </ul>

                </div>

                <p v-else-if="turnNote(turn)" class="ai-msg-note">{{ turnNote(turn) }}</p>

                <div v-if="turn.added.length > 0" class="ai-added">
                  <p class="ai-added-title">
                    <PhCheck :size="16" weight="bold" aria-hidden="true" />
                    {{ focusEventId
                      ? outcomeMessage(turn)
                      : turn.outcome === "partial"
                        ? outcomeMessage(turn)
                        : `Added ${turn.added.length} event${turn.added.length === 1 ? "" : "s"}` }}
                  </p>
                  <ul class="ai-added-list">
                    <li
                      v-for="(draft, index) in turn.added"
                      :key="`added-${draft.title}-${index}`"
                      class="ai-added-item"
                    >
                      <span class="ai-added-copy">
                        <span class="ai-added-name">{{ draft.title }}</span>
                        <span class="ai-added-when">{{ formatWhen(draft) }}</span>
                        <span v-if="repeatLabel(draft)" class="ai-added-repeat">{{ repeatLabel(draft) }}</span>
                      </span>
                    </li>
                  </ul>
                </div>

                <div v-if="isActive(turn) && visibleActions(turn).length > 0" class="ai-msg-actions">
                  <template v-for="action in visibleActions(turn)" :key="action">
                    <UiButton v-if="action === 'done'" @click="finish">Done</UiButton>
                    <UiButton
                      v-else-if="action === 'add_another'"
                      variant="ghost"
                      @click="startOver"
                    >
                      Add another
                    </UiButton>
                    <UiButton
                      v-else-if="action === 'add_manually'"
                      variant="ghost"
                      @click="emit('manual')"
                    >
                      Add manually
                    </UiButton>
                  </template>
                </div>

              </div>
            </template>
          </article>
        </div>
      </div>

      <div v-if="!loadingConversation && !conversationError" class="ai-compose-area">
        <div v-if="reviewTurn" class="ai-review-bar">
          <span class="ai-add-count">
            {{ focusEventId ? "Review the change, then save." : reviewNote(reviewTurn) }}
          </span>
          <UiButton
            :disabled="applying || selectedCount(reviewTurn) === 0 || blockingConflicts(reviewTurn).length > 0 || editingIndex !== null"
            @click="applySelected"
          >
            {{ applying
              ? (focusEventId ? "Updating…" : "Applying…")
              : focusEventId
                ? "Update event"
                : hasExistingChanges(reviewTurn)
                  ? `Apply ${selectedCount(reviewTurn)} ${selectedCount(reviewTurn) === 1 ? "change" : "changes"}`
                  : `Add ${selectedCount(reviewTurn)} ${selectedCount(reviewTurn) === 1 ? "event" : "events"}` }}
          </UiButton>
        </div>

        <div class="ai-composer">
        <div v-if="pendingImage" class="ai-attachment">
          <img :src="pendingImage.dataUrl" :alt="pendingImage.name || 'Attached image'" class="ai-attachment-thumb" />
          <span class="ai-attachment-name">{{ pendingImage.name }}</span>
          <button type="button" class="ai-attachment-clear" aria-label="Remove image" @click="clearImage">
            <PhX :size="16" aria-hidden="true" />
          </button>
        </div>

        <p v-if="inputError" class="ai-error ai-composer-error" role="alert">
          <PhWarning :size="16" weight="fill" class="ai-error-icon" aria-hidden="true" />
          <span>{{ inputError }}</span>
        </p>

        <div class="ai-composer-box">
          <button
            type="button"
            class="ai-attach"
            aria-label="Add a photo"
            title="Add a photo"
            :disabled="parsing"
            @click="openFilePicker"
          >
            <PhPlus :size="20" weight="bold" aria-hidden="true" />
          </button>
          <textarea
            ref="composerEl"
            v-model="composerText"
            class="ai-composer-input"
            rows="1"
            :placeholder="focusEventId
              ? 'Describe the change to this event…'
              : 'Describe an event, or add a photo…'"
            aria-label="Message"
            :disabled="parsing || applying"
            @input="onTextInput"
            @keydown="onComposerKeydown"
          />
          <button
            type="button"
            class="ai-send"
            aria-label="Send message"
            :disabled="!canSend"
            @click="sendMessage()"
          >
            <PhArrowUp :size="20" weight="bold" aria-hidden="true" />
          </button>
        </div>
        <input
          ref="fileInput"
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          class="ai-file"
          @change="onFileChange"
        />
        </div>
      </div>

      <div v-if="dragging" class="ai-drop-hint" aria-hidden="true">
        <PhImage :size="24" aria-hidden="true" />
        <span>Drop a photo to attach it</span>
      </div>
    </template>
  </div>
</template>

<style scoped>
.ai-import {
  position: relative;
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: var(--space-3);
  min-height: 0;
}

.ai-sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}

/* ── Status ── */
.ai-skeleton {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-4);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-bgSurface);
}

.ai-skeleton-line {
  display: block;
  width: 78%;
  height: 12px;
  border-radius: var(--radius-full);
  background: var(--color-bgSubtle);
  animation: ai-skeleton-pulse 1.4s ease-in-out infinite;
}

.ai-skeleton-line--wide { width: 94%; }
.ai-skeleton-line--short { width: 52%; }

@keyframes ai-skeleton-pulse {
  0%, 100% { opacity: 0.55; }
  50% { opacity: 1; }
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

.ai-setup-copy { flex: 1; min-width: 0; }

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

/* ── Chat header ── */
.ai-chat-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  min-height: 36px;
}

.ai-chat-label {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  color: var(--color-textSecondary);
  font-size: var(--text-label-size);
  font-weight: var(--font-weight-medium);
}

.ai-new-chat {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  min-height: 40px;
  padding: 0 var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-full);
  background: var(--color-bgSurface);
  color: var(--color-textPrimary);
  font-family: var(--font-family);
  font-size: var(--text-label-size);
  font-weight: var(--font-weight-medium);
  cursor: pointer;
  transition: border-color var(--duration-fast), background var(--duration-fast);
}

.ai-new-chat:hover {
  border-color: var(--color-borderStrong);
  background: var(--color-bgSubtle);
}

.ai-focus {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  border: 1px solid color-mix(in srgb, var(--color-accent-dark) 35%, var(--color-border));
  border-radius: var(--radius-sm);
  background: color-mix(in srgb, var(--color-accent-lighter) 45%, var(--color-bgSurface));
  color: var(--color-textPrimary);
  font-size: var(--text-label-size);
}

.ai-focus svg {
  flex-shrink: 0;
  color: var(--color-accent-darker);
}

.ai-chat-loading {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-4) 0;
}

/* ── Transcript ── */
.ai-chat {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  scroll-behavior: smooth;
}

.ai-chat--empty {
  display: flex;
  flex-direction: column;
  justify-content: center;
}

.ai-log {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  padding-bottom: var(--space-2);
}

.ai-msg {
  display: flex;
  gap: var(--space-2);
  min-width: 0;
  animation: ai-msg-in var(--duration-base) ease-out both;
}

@keyframes ai-msg-in {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: translateY(0); }
}

.ai-msg--user {
  justify-content: flex-end;
}

.ai-msg--assistant {
  align-items: flex-start;
}

.ai-bubble {
  max-width: 88%;
  padding: var(--space-3) var(--space-4);
  border: 1px solid color-mix(in srgb, var(--color-accent-dark) 30%, var(--color-border));
  border-radius: var(--radius-md) var(--radius-md) var(--radius-xs) var(--radius-md);
  background: color-mix(in srgb, var(--color-accent-lighter) 78%, var(--color-bgSurface));
  color: var(--color-textPrimary);
}

.ai-bubble-text {
  margin: 0;
  font-size: var(--text-body-size);
  line-height: 1.5;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.ai-bubble-image {
  display: block;
  max-width: 100%;
  max-height: 220px;
  margin-top: var(--space-2);
  border-radius: var(--radius-xs);
  object-fit: cover;
}

.ai-bubble-file {
  margin: var(--space-1) 0 0;
  color: var(--color-textSecondary);
  font-size: var(--text-micro-size);
  overflow-wrap: anywhere;
}

.ai-avatar {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  margin-top: 2px;
  border: 1px solid color-mix(in srgb, var(--color-accent-dark) 35%, var(--color-border));
  border-radius: var(--radius-full);
  background: color-mix(in srgb, var(--color-accent-lighter) 70%, var(--color-bgSurface));
  color: var(--color-accent-darker);
}

.ai-msg-body {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: var(--space-3);
  min-width: 0;
}

.ai-msg-text {
  margin: 0;
  color: var(--color-textPrimary);
  font-size: var(--text-body-size);
  line-height: 1.6;
  overflow-wrap: anywhere;
}

.ai-msg-note {
  margin: 0;
  color: var(--color-textMuted);
  font-size: var(--text-label-size);
}

.ai-msg-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.ai-typing {
  display: flex;
  align-items: center;
  gap: 5px;
  min-height: 18px;
}

.ai-typing-dot {
  width: 6px;
  height: 6px;
  border-radius: var(--radius-full);
  background: var(--color-accent-darker);
  animation: ai-typing 1.1s ease-in-out infinite;
}

.ai-typing-dot:nth-child(2) { animation-delay: 0.15s; }
.ai-typing-dot:nth-child(3) { animation-delay: 0.3s; }

@keyframes ai-typing {
  0%, 60%, 100% { opacity: 0.25; transform: translateY(0); }
  30% { opacity: 1; transform: translateY(-2px); }
}

/* ── Welcome ── */
.ai-welcome {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-3);
  padding: var(--space-5) var(--space-1) var(--space-2);
  animation: ai-welcome-in var(--duration-slow) ease-out both;
}

@keyframes ai-welcome-in {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: translateY(0); }
}

.ai-welcome-head {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  width: 100%;
  min-width: 0;
}

.ai-welcome-mark {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  border: 1px solid color-mix(in srgb, var(--color-accent-dark) 32%, var(--color-border));
  border-radius: var(--radius-md);
  background: color-mix(in srgb, var(--color-accent-lighter) 72%, var(--color-bgSurface));
  color: var(--color-accent-darker);
}

.ai-welcome-title {
  flex: 1;
  min-width: 0;
  margin: 0;
  color: var(--color-textPrimary);
  font-size: var(--text-title-size);
  font-weight: var(--font-weight-regular);
  line-height: var(--text-title-line-height);
}

.ai-welcome-copy {
  max-width: 42ch;
  margin: 0;
  color: var(--color-textSecondary);
  font-size: var(--text-body-size);
  line-height: 1.6;
}

.ai-seed-note {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  border: 1px solid color-mix(in srgb, var(--color-info) 35%, var(--color-border));
  border-radius: var(--radius-sm);
  background: color-mix(in srgb, var(--color-info) 8%, var(--color-bgSurface));
  color: var(--color-textSecondary);
  font-size: var(--text-label-size);
  line-height: 1.5;
}

.ai-seed-note svg {
  flex-shrink: 0;
  margin-top: 1px;
  color: var(--color-info);
}

.ai-seed-note p {
  margin: 0;
}

/* ── Questions ── */
.ai-questions {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.ai-question {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.ai-question-text {
  margin: 0;
  color: var(--color-textPrimary);
  font-size: var(--text-body-size);
  font-weight: var(--font-weight-medium);
  line-height: 1.5;
  overflow-wrap: anywhere;
}

.ai-datetime {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-bgSurface);
}

.ai-datetime-row {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
}

.ai-datetime-field {
  display: flex;
  flex: 1 1 140px;
  flex-direction: column;
  gap: var(--space-1);
  min-width: 0;
}

.ai-datetime-label {
  color: var(--color-textSecondary);
  font-size: var(--text-label-size);
  font-weight: var(--font-weight-medium);
}

.ai-quick-replies {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.ai-quick-reply {
  min-height: 40px;
  padding: 0 var(--space-3);
  border: 1px solid var(--color-borderStrong);
  border-radius: var(--radius-full);
  background: var(--color-bgSurface);
  color: var(--color-textPrimary);
  font-family: var(--font-family);
  font-size: var(--text-label-size);
  font-weight: var(--font-weight-medium);
  cursor: pointer;
  transition: border-color var(--duration-fast), background var(--duration-fast);
}

.ai-quick-reply:hover:not(:disabled) {
  border-color: var(--color-accent-darker);
  background: color-mix(in srgb, var(--color-accent-lighter) 45%, var(--color-bgSurface));
}

.ai-quick-reply:disabled {
  opacity: 0.55;
  cursor: default;
}

/* ── Confirmation card ── */
.ai-confirm {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-bgSurface);
}

.ai-confirm-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-3);
}

.ai-confirm-title {
  margin: 0;
  color: var(--color-textPrimary);
  font-size: var(--text-heading-size);
  font-weight: var(--font-weight-medium);
  line-height: 1.3;
}

.ai-confirm-sub {
  margin: 2px 0 0;
  color: var(--color-textSecondary);
  font-size: var(--text-label-size);
  line-height: 1.4;
}

.ai-select-all {
  flex-shrink: 0;
  min-height: 40px;
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
  margin: 0;
  padding: 0;
  list-style: none;
}

.ai-item {
  border-top: 1px solid var(--color-border);
}

.ai-item:first-child {
  border-top: none;
}

.ai-item--editing {
  border-top-color: transparent;
}

.ai-item-main {
  display: flex;
  align-items: flex-start;
  gap: var(--space-3);
  padding: var(--space-3) 0;
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
  padding: var(--space-3) 0 var(--space-4);
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

/* ── Composer and review action ── */
.ai-compose-area {
  display: flex;
  flex: none;
  flex-direction: column;
  gap: var(--space-2);
  padding-top: var(--space-2);
  background: var(--color-bgElevated);
}

.ai-review-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  padding-top: var(--space-2);
  border-top: 1px solid var(--color-border);
}

.ai-add-count {
  color: var(--color-textSecondary);
  font-size: var(--text-label-size);
  font-variant-numeric: tabular-nums;
}

/* ── Callouts and warnings ── */
.ai-callout {
  display: flex;
  align-items: flex-start;
  gap: var(--space-3);
  padding: var(--space-3);
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
  font-size: var(--text-label-size);
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

.ai-conflicts {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  margin: var(--space-2) 0 0;
  padding: 0;
  list-style: none;
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

.ai-actions {
  display: flex;
  flex-direction: column;
  margin: 0;
  padding: 0;
  list-style: none;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-bgSurface);
  overflow: hidden;
}

.ai-actions--danger {
  border-color: color-mix(in srgb, var(--color-danger) 35%, var(--color-border));
}

.ai-action {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
}

.ai-action + .ai-action {
  border-top: 1px solid var(--color-border);
}

.ai-action-copy {
  display: flex;
  flex: 1;
  min-width: 0;
  flex-direction: column;
  gap: 2px;
  cursor: pointer;
}

.ai-action-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
}

.ai-action-kind {
  color: var(--color-textSecondary);
  font-size: var(--text-micro-size);
  font-weight: var(--font-weight-medium);
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.ai-action-kind--danger {
  color: var(--color-danger);
}

.ai-action-title {
  color: var(--color-textPrimary);
  font-size: var(--text-label-size);
  font-weight: var(--font-weight-medium);
  overflow-wrap: anywhere;
}

.ai-action-badge {
  padding: 0 var(--space-1);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  color: var(--color-textSecondary);
  font-size: var(--text-micro-size);
}

.ai-action-sub {
  color: var(--color-textSecondary);
  font-size: var(--text-label-size);
  overflow-wrap: anywhere;
}

.ai-action-apply {
  flex-shrink: 0;
  min-height: 32px;
  padding: 0 var(--space-2);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-textPrimary);
  font: inherit;
  font-size: var(--text-label-size);
  cursor: pointer;
}

.ai-action-apply:hover:not(:disabled) {
  background: var(--color-bgSubtle);
}

.ai-action-apply--danger {
  border-color: color-mix(in srgb, var(--color-danger) 40%, var(--color-border));
  color: var(--color-danger);
}

.ai-action-apply:disabled {
  opacity: 0.5;
  cursor: default;
}

.ai-replacements {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  padding: var(--space-2) var(--space-3);
  border: 1px solid color-mix(in srgb, var(--color-danger) 30%, var(--color-border));
  border-radius: var(--radius-sm);
  background: color-mix(in srgb, var(--color-danger) 7%, var(--color-bgSurface));
}

.ai-replacements-title {
  margin: 0;
  color: var(--color-textSecondary);
  font-size: var(--text-micro-size);
  font-weight: var(--font-weight-medium);
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.ai-replacements-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  margin: 0;
  padding: 0;
  list-style: none;
}

.ai-replacement {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
}

.ai-replacement-name {
  color: var(--color-textPrimary);
  font-size: var(--text-label-size);
  font-weight: var(--font-weight-medium);
  overflow-wrap: anywhere;
}

.ai-replacement-undo {
  flex-shrink: 0;
  min-height: 40px;
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

.ai-replacement-undo:hover {
  background: var(--color-bgSubtle);
}

/* ── Added ── */
.ai-added {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-3);
  border: 1px solid color-mix(in srgb, var(--color-success) 40%, var(--color-border));
  border-radius: var(--radius-md);
  background: color-mix(in srgb, var(--color-success) 9%, var(--color-bgSurface));
}

.ai-added-title {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  margin: 0;
  color: var(--color-textPrimary);
  font-size: var(--text-label-size);
  font-weight: var(--font-weight-medium);
}

.ai-added-title svg {
  color: var(--color-success);
}

.ai-added-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  margin: 0;
  padding: 0;
  list-style: none;
}

.ai-added-item {
  padding: var(--space-1) 0;
}

.ai-added-item + .ai-added-item {
  border-top: 1px solid color-mix(in srgb, var(--color-success) 24%, transparent);
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

/* ── Errors ── */
.ai-error {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
  margin: 0;
  padding: var(--space-2) var(--space-3);
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

/* ── Composer ── */
.ai-composer {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.ai-composer-box {
  display: flex;
  align-items: flex-end;
  gap: var(--space-2);
  padding: var(--space-2);
  border: 1px solid var(--color-borderStrong);
  border-radius: var(--radius-md);
  background: var(--color-bgSurface);
  transition: border-color var(--duration-fast), box-shadow var(--duration-fast);
}

.ai-composer-box:focus-within {
  border-color: var(--color-accent-darker);
  box-shadow: 0 0 0 1px var(--color-accent-darker);
}

.ai-attach,
.ai-send {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  min-width: 40px;
  min-height: 40px;
  border-radius: var(--radius-full);
  cursor: pointer;
}

.ai-attach {
  border: 1px solid var(--color-border);
  background: var(--color-bgElevated);
  color: var(--color-textSecondary);
  transition: border-color var(--duration-fast), color var(--duration-fast);
}

.ai-attach:hover:not(:disabled) {
  border-color: var(--color-accent-darker);
  color: var(--color-accent-darker);
}

.ai-attach:disabled {
  opacity: 0.5;
  cursor: default;
}

.ai-send {
  border: none;
  background: var(--color-accent-darker);
  color: var(--color-on-accent, var(--color-textInverse));
  transition: opacity var(--duration-fast), transform var(--duration-fast);
}

.ai-send:hover:not(:disabled) {
  opacity: 0.9;
}

.ai-send:disabled {
  background: var(--color-bgSubtle);
  color: var(--color-textMuted);
  cursor: default;
}

.ai-composer-input {
  flex: 1;
  min-height: 40px;
  max-height: 144px;
  padding: var(--space-2) 0;
  border: none;
  background: transparent;
  color: var(--color-textPrimary);
  font-family: var(--font-family);
  font-size: var(--text-body-size);
  line-height: 1.5;
  resize: none;
  outline: none;
}

.ai-composer-input::placeholder {
  color: var(--color-textSecondary);
}

.ai-composer-input:focus-visible {
  outline: none;
}

.ai-attachment {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-bgSubtle);
}

.ai-attachment-thumb {
  flex-shrink: 0;
  width: 48px;
  height: 48px;
  border-radius: var(--radius-xs);
  object-fit: cover;
}

.ai-attachment-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  color: var(--color-textPrimary);
  font-size: var(--text-label-size);
  font-weight: var(--font-weight-medium);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ai-attachment-clear {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  min-width: 40px;
  min-height: 40px;
  border: none;
  border-radius: var(--radius-full);
  background: transparent;
  color: var(--color-textSecondary);
  cursor: pointer;
}

.ai-attachment-clear:hover {
  background: var(--color-bgSurface);
}

.ai-composer-error {
  margin-bottom: var(--space-1);
}

.ai-file {
  display: none;
}

.ai-drop-hint {
  position: absolute;
  inset: 0;
  z-index: 5;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  border: 2px dashed var(--color-accent-darker);
  border-radius: var(--radius-md);
  background: color-mix(in srgb, var(--color-bgElevated) 88%, transparent);
  color: var(--color-accent-darker);
  font-size: var(--text-body-size);
  font-weight: var(--font-weight-medium);
  pointer-events: none;
}

/* ── Focus ── */
.ai-new-chat:focus-visible,
.ai-quick-reply:focus-visible,
.ai-select-all:focus-visible,
.ai-item-edit:focus-visible,
.ai-replacement-undo:focus-visible,
.ai-attach:focus-visible,
.ai-send:focus-visible,
.ai-attachment-clear:focus-visible,
.ai-checkbox:focus-visible,
.ai-edit-toggle input:focus-visible {
  outline: 2px solid var(--color-accent-darker);
  outline-offset: 2px;
}

@media (prefers-reduced-motion: reduce) {
  .ai-chat {
    scroll-behavior: auto;
  }

  .ai-msg,
  .ai-welcome,
  .ai-skeleton-line,
  .ai-typing-dot {
    animation: none !important;
    transition: none !important;
  }
}

html.low-power .ai-skeleton-line,
html.low-power .ai-typing-dot {
  animation: none;
}

/* Futur uses ink contours and hard offset shadows; match that world. */
:global(.futur .ai-composer-box),
:global(.futur .ai-confirm),
:global(.futur .ai-datetime),
:global(.futur .ai-focus),
:global(.futur .ai-seed-note),
:global(.futur .ai-replacements),
:global(.futur .ai-added),
:global(.futur .ai-callout),
:global(.futur .ai-setup) {
  border: 2px solid var(--color-ink);
  box-shadow: 0 2px 0 0 var(--color-ink);
}

:global(.futur .ai-bubble) {
  border: 2px solid var(--color-ink);
}

:global(.futur .ai-avatar),
:global(.futur .ai-welcome-mark) {
  border: 2px solid var(--color-ink);
}

:global(.futur .ai-item--low) {
  border-top-color: var(--color-warningFill);
}
</style>
