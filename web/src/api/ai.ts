import { api } from "./client"

export type AiProvider = "console" | "go"

export interface AiStatus {
  configured: boolean
  provider: AiProvider
  model: string
  keyHint: string | null
}

export interface AiRecurrence {
  freq: string
  until?: string | null
  count?: number | null
}

export interface AiDraft {
  title: string
  description: string
  startAt: string
  endAt: string | null
  allDay: boolean
  recurrence: AiRecurrence | null
  reminderMinutes: number | null
  assigneeId: string | null
  confidence: number
}

/** Only the fields a Smart change actually touches; sent as the PATCH body. */
export interface AiEventChangeSet {
  title?: string
  description?: string
  start_at?: string
  end_at?: string | null
  all_day?: boolean
  recurrence?: AiRecurrence | null
  reminder_minutes?: number | null
  assignee_id?: string | null
}

export interface AiEventUpdate {
  ref: number
  eventId: string
  title: string
  startAt: string
  endAt: string | null
  allDay: boolean
  external: boolean
  before: { title: string; start_at: string; end_at: string | null; all_day: boolean }
  after: { title: string; start_at: string; end_at: string | null; all_day: boolean }
  changes: AiEventChangeSet
}

export interface AiEventDelete {
  ref: number
  eventId: string
  title: string
  startAt: string
  endAt: string | null
  allDay: boolean
  external: boolean
  reason: string
}

export interface AiClarification {
  question: string
  answer: string
}

export type AiQuestionKind = "clarification" | "assignee" | "conflict" | "datetime"

export interface AiQuestion {
  id: string
  kind: AiQuestionKind
  question: string
  options: string[]
  about: string | null
}

export interface AiConflict {
  id: string
  draftIndex: number
  title: string
  startAt: string
  endAt: string | null
  existingTitle: string
  existingStartAt: string
  existingEndAt: string | null
  existingKind: "existing" | "draft"
  existingEventId: string | null
  existingRecurring: boolean
  assigneeId: string | null
  message: string
}

export interface AiChatMessage {
  role: "user" | "assistant"
  text: string
}

export interface AiConversationTurn {
  role: "user" | "assistant"
  text: string
  imageName: string
  /** Stored copy of the attached screenshot, served from /uploads. */
  imageUrl: string
  rawResponse: string
  reply: string
  drafts: AiDraft[]
  added: AiDraft[]
  updates: AiEventUpdate[]
  deletes: AiEventDelete[]
  questions: AiQuestion[]
  warnings: string[]
  applied: boolean
  outcome: "success" | "partial" | "failed" | null
  documentKind: string
  actions: string[]
  /** False for conversations saved before model-chosen actions existed. */
  actionsDeclared: boolean
}

export interface AiConversation {
  id: string
  title: string
  turns: AiConversationTurn[]
  createdAt: string
  updatedAt: string
}

export interface AiConversationWrite {
  title: string
  turns: AiConversationTurn[]
}

/** A screenshot kept beside a conversation, so a reopened chat can show it. */
export interface AiStoredImage {
  name: string
  url: string
}

export interface AiParseResult {
  events: AiDraft[]
  updates: AiEventUpdate[]
  deletes: AiEventDelete[]
  skipped: number
  model: string
  reply: string
  response: string
  reasoning: string | null
  warnings: string[]
  questions: AiQuestion[]
  conflicts: AiConflict[]
  needsInput: boolean
  documentKind: string
  actions: string[]
}

export interface AiStreamHandlers {
  onReasoning?: (text: string) => void
  onContent?: (text: string) => void
}

export interface AiTestResult extends AiStatus {
  ok: boolean
  message: string
}

export interface AiModel {
  id: string
  name: string
  supportsImages: boolean
}

export interface AiModelsResult {
  models: AiModel[]
  provider: AiProvider
  selected: string
}

interface ApiStatus {
  configured: boolean
  provider: string
  model: string
  key_hint: string | null
}

interface ApiDraft {
  title: string
  description: string
  start_at: string
  end_at: string | null
  all_day: boolean
  recurrence: AiRecurrence | null
  reminder_minutes: number | null
  assignee_id: string | null
  confidence: number
}

interface ApiEventUpdate {
  ref: number
  event_id: string
  title: string
  start_at: string
  end_at: string | null
  all_day: boolean
  external?: boolean
  before?: {
    title?: string
    start_at?: string
    end_at?: string | null
    all_day?: boolean
  }
  after?: {
    title?: string
    start_at?: string
    end_at?: string | null
    all_day?: boolean
  }
  changes?: AiEventChangeSet
}

interface ApiEventDelete {
  ref: number
  event_id: string
  title: string
  start_at: string
  end_at: string | null
  all_day: boolean
  external?: boolean
  reason?: string
}

interface ApiQuestion {
  id?: string
  kind?: string
  question?: string
  options?: string[]
  about?: string | null
}

interface ApiConflict {
  id?: string
  draft_index?: number
  title?: string
  start_at?: string
  end_at?: string | null
  existing_title?: string
  existing_start_at?: string
  existing_end_at?: string | null
  existing_kind?: string
  existing_event_id?: string | null
  existing_recurring?: boolean
  assignee_id?: string | null
  message?: string
}

interface ApiParseResult {
  events: ApiDraft[]
  updates?: ApiEventUpdate[]
  deletes?: ApiEventDelete[]
  skipped: number
  model: string
  reply?: string
  response?: string
  reasoning?: string | null
  warnings?: string[]
  questions?: ApiQuestion[]
  conflicts?: ApiConflict[]
  needs_input?: boolean
  document_kind?: string
  actions?: string[]
}

interface ApiConversationTurn {
  role: "user" | "assistant"
  text?: string
  image_name?: string | null
  image_url?: string | null
  raw_response?: string | null
  reply?: string | null
  drafts?: ApiDraft[]
  added?: ApiDraft[]
  updates?: ApiEventUpdate[]
  deletes?: ApiEventDelete[]
  questions?: ApiQuestion[]
  warnings?: string[]
  applied?: boolean
  outcome?: "success" | "partial" | "failed" | null
  document_kind?: string
  actions?: string[]
}

interface ApiConversation {
  id: string
  title: string
  turns: ApiConversationTurn[]
  created_at: string
  updated_at: string
}

interface ApiTestResult extends ApiStatus {
  ok: boolean
  message: string
}

interface ApiModel {
  id: string
  name: string
  supports_images: boolean
}

interface ApiModelsResult {
  models: ApiModel[]
  provider: string
  selected: string
}

function mapStatus(s: ApiStatus): AiStatus {
  return {
    configured: s.configured,
    provider: s.provider === "go" ? "go" : "console",
    model: s.model,
    keyHint: s.key_hint,
  }
}

function mapQuestion(q: ApiQuestion, index: number): AiQuestion {
  const kind: AiQuestionKind =
    q.kind === "assignee" || q.kind === "conflict" || q.kind === "datetime"
      ? q.kind
      : "clarification"
  return {
    id: typeof q.id === "string" && q.id ? q.id : `q${index + 1}`,
    kind,
    question: q.question!,
    options: Array.isArray(q.options)
      ? q.options.filter((option): option is string => typeof option === "string")
      : [],
    about: typeof q.about === "string" ? q.about : null,
  }
}

function mapDraft(d: ApiDraft): AiDraft {
  return {
    title: d.title,
    description: d.description ?? "",
    startAt: d.start_at,
    endAt: d.end_at,
    allDay: d.all_day,
    recurrence: d.recurrence,
    reminderMinutes: d.reminder_minutes,
    assigneeId: d.assignee_id,
    confidence: d.confidence,
  }
}

function mapUpdate(u: ApiEventUpdate): AiEventUpdate {
  const before = u.before ?? {}
  const after = u.after ?? {}
  return {
    ref: u.ref,
    eventId: u.event_id,
    title: u.title,
    startAt: u.start_at,
    endAt: u.end_at ?? null,
    allDay: u.all_day === true,
    external: u.external === true,
    before: {
      title: before.title ?? u.title,
      start_at: before.start_at ?? u.start_at,
      end_at: before.end_at ?? null,
      all_day: before.all_day === true,
    },
    after: {
      title: after.title ?? u.title,
      start_at: after.start_at ?? u.start_at,
      end_at: after.end_at ?? null,
      all_day: after.all_day === true,
    },
    changes: u.changes ?? {},
  }
}

function mapDelete(d: ApiEventDelete): AiEventDelete {
  return {
    ref: d.ref,
    eventId: d.event_id,
    title: d.title,
    startAt: d.start_at,
    endAt: d.end_at ?? null,
    allDay: d.all_day === true,
    external: d.external === true,
    reason: d.reason ?? "",
  }
}

function updatePayload(u: AiEventUpdate) {
  return {
    ref: u.ref,
    event_id: u.eventId,
    title: u.title,
    start_at: u.startAt,
    end_at: u.endAt,
    all_day: u.allDay,
    external: u.external,
    before: u.before,
    after: u.after,
    changes: u.changes,
  }
}

function deletePayload(d: AiEventDelete) {
  return {
    ref: d.ref,
    event_id: d.eventId,
    title: d.title,
    start_at: d.startAt,
    end_at: d.endAt,
    all_day: d.allDay,
    external: d.external,
    reason: d.reason,
  }
}

function mapParseResult(r: ApiParseResult): AiParseResult {
  const questions = Array.isArray(r.questions) ? r.questions : []
  const conflicts = Array.isArray(r.conflicts) ? r.conflicts : []
  return {
    events: (Array.isArray(r.events) ? r.events : []).map(mapDraft),
    updates: (Array.isArray(r.updates) ? r.updates : []).map(mapUpdate),
    deletes: (Array.isArray(r.deletes) ? r.deletes : []).map(mapDelete),
    skipped: r.skipped ?? 0,
    model: r.model,
    reply: typeof r.reply === "string" ? r.reply : "",
    response: typeof r.response === "string" ? r.response : "",
    reasoning: typeof r.reasoning === "string" ? r.reasoning : null,
    warnings: Array.isArray(r.warnings)
      ? r.warnings.filter((warning): warning is string => typeof warning === "string")
      : [],
    questions: questions
      .filter(q => typeof q.question === "string" && q.question.trim().length > 0)
      .map(mapQuestion),
    conflicts: conflicts
      .filter(c => typeof c.message === "string" && typeof c.draft_index === "number")
      .map((c, index) => ({
        id: typeof c.id === "string" && c.id ? c.id : `conflict-${index + 1}`,
        draftIndex: c.draft_index!,
        title: c.title ?? "",
        startAt: c.start_at ?? "",
        endAt: c.end_at ?? null,
        existingTitle: c.existing_title ?? "",
        existingStartAt: c.existing_start_at ?? "",
        existingEndAt: c.existing_end_at ?? null,
        existingKind: c.existing_kind === "draft" ? "draft" : "existing",
        existingEventId: c.existing_event_id ?? null,
        existingRecurring: c.existing_recurring === true,
        assigneeId: c.assignee_id ?? null,
        message: c.message!,
      })),
    needsInput: r.needs_input === true,
    documentKind: typeof r.document_kind === "string" ? r.document_kind : "other",
    actions: Array.isArray(r.actions)
      ? r.actions.filter((action): action is string => typeof action === "string")
      : [],
  }
}

function mapConversationTurn(turn: ApiConversationTurn): AiConversationTurn {
  return {
    role: turn.role === "assistant" ? "assistant" : "user",
    text: typeof turn.text === "string" ? turn.text : "",
    imageName: typeof turn.image_name === "string" ? turn.image_name : "",
    imageUrl: typeof turn.image_url === "string" ? turn.image_url : "",
    rawResponse: typeof turn.raw_response === "string" ? turn.raw_response : "",
    reply: typeof turn.reply === "string" ? turn.reply : "",
    drafts: (Array.isArray(turn.drafts) ? turn.drafts : []).map(mapDraft),
    added: (Array.isArray(turn.added) ? turn.added : []).map(mapDraft),
    updates: (Array.isArray(turn.updates) ? turn.updates : []).map(mapUpdate),
    deletes: (Array.isArray(turn.deletes) ? turn.deletes : []).map(mapDelete),
    questions: (Array.isArray(turn.questions) ? turn.questions : [])
      .filter(q => typeof q.question === "string" && q.question.trim().length > 0)
      .map(mapQuestion),
    warnings: Array.isArray(turn.warnings)
      ? turn.warnings.filter((warning): warning is string => typeof warning === "string")
      : [],
    applied: turn.applied === true,
    outcome: turn.outcome === "success" || turn.outcome === "partial" || turn.outcome === "failed"
      ? turn.outcome
      : null,
    documentKind: typeof turn.document_kind === "string" ? turn.document_kind : "other",
    actions: Array.isArray(turn.actions)
      ? turn.actions.filter((action): action is string => typeof action === "string")
      : [],
    actionsDeclared: Array.isArray(turn.actions),
  }
}

function mapConversation(raw: ApiConversation): AiConversation {
  return {
    id: raw.id,
    title: typeof raw.title === "string" ? raw.title : "",
    turns: (Array.isArray(raw.turns) ? raw.turns : []).map(mapConversationTurn),
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
  }
}

function draftPayload(draft: AiDraft) {
  return {
    title: draft.title,
    description: draft.description,
    start_at: draft.startAt,
    end_at: draft.endAt,
    all_day: draft.allDay,
    recurrence: draft.recurrence,
    reminder_minutes: draft.reminderMinutes,
    assignee_id: draft.assigneeId,
    confidence: draft.confidence,
  }
}

function conversationPayload(payload: AiConversationWrite) {
  return {
    title: payload.title,
    turns: payload.turns.map(turn => ({
      role: turn.role,
      text: turn.text,
      image_name: turn.imageName || null,
      image_url: turn.imageUrl || null,
      raw_response: turn.rawResponse || null,
      reply: turn.reply || null,
      drafts: turn.drafts.map(draftPayload),
      added: turn.added.map(draftPayload),
      updates: turn.updates.map(updatePayload),
      deletes: turn.deletes.map(deletePayload),
      questions: turn.questions,
      warnings: turn.warnings,
      applied: turn.applied,
      outcome: turn.outcome,
      document_kind: turn.documentKind,
      ...(turn.actionsDeclared ? { actions: turn.actions } : {}),
    })),
  }
}

function frameParts(frame: string): { event: string; data: string } {
  let event = "message"
  const data: string[] = []
  for (const line of frame.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim()
    else if (line.startsWith("data:")) data.push(line.slice(5).trimStart())
  }
  return { event, data: data.join("\n") }
}

/**
 * Streams reasoning/content deltas from `/ai/parse/stream` and resolves with
 * the final validated result. Each SSE frame is handled as soon as it arrives.
 */
export async function parseStream(
  payload: {
    text: string
    image?: string | null
    timezone?: string | null
    clarifications?: AiClarification[]
    history?: AiChatMessage[]
    focusEventId?: string | null
  },
  handlers: AiStreamHandlers = {},
): Promise<AiParseResult> {
  let response: Response
  try {
    response = await fetch("/api/v1/ai/parse/stream", {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify({
        text: payload.text,
        image: payload.image ?? null,
        timezone: payload.timezone ?? null,
        clarifications: payload.clarifications ?? [],
        history: payload.history ?? [],
        focus_event_id: payload.focusEventId ?? null,
      }),
    })
  } catch {
    throw new Error("Could not reach the HOMST server.")
  }

  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    throw new Error(body.detail ?? `Request failed: ${response.status}`)
  }
  if (!response.body) throw new Error("This browser cannot read a response stream.")

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  let result: AiParseResult | null = null

  const handleFrame = (frame: string) => {
    const { event, data } = frameParts(frame)
    if (!data) return
    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(data) as Record<string, unknown>
    } catch {
      return
    }
    if (event === "reasoning" && typeof parsed.text === "string") {
      handlers.onReasoning?.(parsed.text)
    } else if (event === "content" && typeof parsed.text === "string") {
      handlers.onContent?.(parsed.text)
    } else if (event === "result") {
      result = mapParseResult(parsed as unknown as ApiParseResult)
    } else if (event === "error") {
      throw new Error(
        typeof parsed.detail === "string" ? parsed.detail : "Smart import failed.",
      )
    }
  }

  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    buffer = buffer.replace(/\r\n/g, "\n")
    let split = buffer.indexOf("\n\n")
    while (split >= 0) {
      handleFrame(buffer.slice(0, split))
      buffer = buffer.slice(split + 2)
      split = buffer.indexOf("\n\n")
    }
  }
  buffer += decoder.decode()
  if (buffer.trim()) handleFrame(buffer.trim())
  if (!result) throw new Error("The model stopped before returning events.")
  return result
}

export const aiApi = {
  status: () => api.get<ApiStatus>("/ai").then(mapStatus),

  save: (apiKey: string, provider: AiProvider, model: string) =>
    api.put<ApiStatus>("/ai", { api_key: apiKey, provider, model }).then(mapStatus),

  remove: () => api.delete("/ai"),

  models: (provider?: AiProvider) =>
    api.get<ApiModelsResult>(`/ai/models${provider ? `?provider=${provider}` : ""}`).then(r => ({
      models: (Array.isArray(r.models) ? r.models : []).map(model => ({
        id: model.id,
        name: model.name || model.id,
        supportsImages: model.supports_images === true,
      })),
      provider: r.provider === "go" ? "go" : "console",
      selected: typeof r.selected === "string" ? r.selected : "",
    })),

  test: () =>
    api.post<ApiTestResult>("/ai/test").then(t => ({
      ...mapStatus(t),
      ok: t.ok,
      message: t.message,
    })),

  parse: (payload: {
    text: string
    image?: string | null
    timezone?: string | null
    clarifications?: AiClarification[]
    history?: AiChatMessage[]
    focusEventId?: string | null
  }) =>
    api.post<ApiParseResult>("/ai/parse", {
      text: payload.text,
      image: payload.image ?? null,
      timezone: payload.timezone ?? null,
      clarifications: payload.clarifications ?? [],
      history: payload.history ?? [],
      focus_event_id: payload.focusEventId ?? null,
    }).then(mapParseResult),

  /** Keep a chat screenshot beside its conversation. */
  uploadImage: (payload: { image: string; name?: string }) =>
    api.post<{ name?: string; url?: string }>("/ai/images", {
      image: payload.image,
      name: payload.name ?? "",
    }).then<AiStoredImage>(stored => ({
      name: typeof stored.name === "string" ? stored.name : "",
      url: typeof stored.url === "string" ? stored.url : "",
    })),

  createConversation: (payload: AiConversationWrite) =>
    api.post<ApiConversation>("/ai/conversations", conversationPayload(payload))
      .then(mapConversation),

  updateConversation: (id: string, payload: AiConversationWrite) =>
    api.patch<ApiConversation>(`/ai/conversations/${id}`, conversationPayload(payload))
      .then(mapConversation),

  getConversation: (id: string) =>
    api.get<ApiConversation>(`/ai/conversations/${id}`).then(mapConversation),
}
