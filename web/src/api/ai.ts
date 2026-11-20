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

export interface AiParseResult {
  events: AiDraft[]
  skipped: number
  model: string
  response: string
  reasoning: string | null
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

interface ApiParseResult {
  events: ApiDraft[]
  skipped: number
  model: string
  response?: string
  reasoning?: string | null
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

function mapParseResult(r: ApiParseResult): AiParseResult {
  return {
    events: (Array.isArray(r.events) ? r.events : []).map(mapDraft),
    skipped: r.skipped ?? 0,
    model: r.model,
    response: typeof r.response === "string" ? r.response : "",
    reasoning: typeof r.reasoning === "string" ? r.reasoning : null,
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
  payload: { text: string; image?: string | null; timezone?: string | null },
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

  parse: (payload: { text: string; image?: string | null; timezone?: string | null }) =>
    api.post<ApiParseResult>("/ai/parse", {
      text: payload.text,
      image: payload.image ?? null,
      timezone: payload.timezone ?? null,
    }).then(mapParseResult),
}
