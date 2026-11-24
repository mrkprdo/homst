import { beforeEach, describe, expect, it, vi } from "vitest"
import { aiApi, parseStream } from "@/api/ai"

const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

const STATUS = {
  configured: true,
  provider: "go",
  model: "deepseek-v4.1-flash",
  key_hint: "…abcd",
}

beforeEach(() => {
  fetchMock.mockReset()
})

describe("aiApi", () => {
  it("reads and maps the status without a key", async () => {
    fetchMock.mockResolvedValueOnce(json(STATUS))
    const status = await aiApi.status()
    expect(status).toEqual({
      configured: true,
      provider: "go",
      model: "deepseek-v4.1-flash",
      keyHint: "…abcd",
    })
  })

  it("maps an unknown provider back to console", async () => {
    fetchMock.mockResolvedValueOnce(json({ ...STATUS, provider: "other" }))
    expect((await aiApi.status()).provider).toBe("console")
  })

  it("saves a key with PUT and returns the masked status", async () => {
    fetchMock.mockResolvedValueOnce(json(STATUS))
    const status = await aiApi.save("oc_sk_x", "go", "glm-5.3-flash")
    expect(status.keyHint).toBe("…abcd")
    const [url, init] = fetchMock.mock.calls[0]!
    expect(String(url)).toContain("/ai")
    expect((init as RequestInit).method).toBe("PUT")
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      api_key: "oc_sk_x",
      provider: "go",
      model: "glm-5.3-flash",
    })
  })

  it("lists models for the picker", async () => {
    fetchMock.mockResolvedValueOnce(
      json({
        provider: "go",
        selected: "deepseek-v4.1-flash",
        models: [
          { id: "deepseek-v4.1-flash", name: "DeepSeek V4.1 Flash", supports_images: true },
          { id: "text-only", name: "", supports_images: false },
        ],
      }),
    )
    const result = await aiApi.models()
    expect(result.provider).toBe("go")
    expect(result.selected).toBe("deepseek-v4.1-flash")
    expect(result.models).toEqual([
      { id: "deepseek-v4.1-flash", name: "DeepSeek V4.1 Flash", supportsImages: true },
      { id: "text-only", name: "text-only", supportsImages: false },
    ])
    expect(String(fetchMock.mock.calls[0]![0])).toContain("/ai/models")

    fetchMock.mockResolvedValueOnce(json({ provider: "go", selected: "m", models: [] }))
    await aiApi.models("go")
    expect(String(fetchMock.mock.calls[1]![0])).toContain("/ai/models?provider=go")

    fetchMock.mockResolvedValueOnce(json({ provider: "other", selected: "m" }))
    const empty = await aiApi.models()
    expect(empty.models).toEqual([])
    expect(empty.provider).toBe("console")
  })

  it("removes the key", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }))
    await expect(aiApi.remove()).resolves.toBeUndefined()
    expect((fetchMock.mock.calls[0]![1] as RequestInit).method).toBe("DELETE")
  })

  it("tests a connection", async () => {
    fetchMock.mockResolvedValueOnce(json({ ...STATUS, ok: true, message: "Connected" }))
    const result = await aiApi.test()
    expect(result.ok).toBe(true)
    expect(result.message).toBe("Connected")
    expect(result.provider).toBe("go")
  })

  it("maps parse drafts and tolerates a missing events array", async () => {
    fetchMock.mockResolvedValueOnce(
      json({
        events: [
          {
            title: "Standup",
            description: "Zoom",
            start_at: "2026-05-04T09:30:00-04:00",
            end_at: "2026-05-04T10:00:00-04:00",
            all_day: false,
            recurrence: { freq: "weekly", count: 5 },
            reminder_minutes: 10,
            assignee_id: "m-1",
            confidence: 0.9,
          },
        ],
        skipped: 2,
        model: "deepseek-v4.1-flash",
        reply: "I found one event.",
        response: '{"events": []}',
        reasoning: "Read the email.",
        warnings: ["Repeating dates were ignored."],
        questions: [
          {
            kind: "assignee",
            question: "Who is this for?",
            options: ["Alice", 5],
            about: "Standup",
          },
          {
            kind: "nonsense",
            question: "Is the year right?",
            options: "nope",
            about: 5,
          },
          {
            kind: "datetime",
            question: "What date and time is the appointment?",
            options: ["Tomorrow morning"],
          },
          { question: "   " },
        ],
        conflicts: [
          {
            draft_index: 0,
            title: "Standup",
            start_at: "2026-05-04T09:30:00-04:00",
            end_at: "2026-05-04T10:00:00-04:00",
            existing_title: "Dentist",
            existing_start_at: "2026-05-04T09:00:00-04:00",
            existing_end_at: "2026-05-04T09:30:00-04:00",
            existing_kind: "draft",
            existing_event_id: "ev-123",
            assignee_id: "m-1",
            message: "Standup overlaps Dentist.",
          },
          { message: 5 },
        ],
        needs_input: true,
      }),
    )
    const result = await aiApi.parse({
      text: "standup",
      image: "data:image/png;base64,abc",
      timezone: "America/Toronto",
      clarifications: [{ question: "Which day?", answer: "Friday" }],
    })
    expect(result.skipped).toBe(2)
    expect(result.reply).toBe("I found one event.")
    expect(result.response).toBe('{"events": []}')
    expect(result.reasoning).toBe("Read the email.")
    expect(result.warnings).toEqual(["Repeating dates were ignored."])
    expect(result.needsInput).toBe(true)
    expect(result.questions).toEqual([
      {
        id: "q1",
        kind: "assignee",
        question: "Who is this for?",
        options: ["Alice"],
        about: "Standup",
      },
      {
        id: "q2",
        kind: "clarification",
        question: "Is the year right?",
        options: [],
        about: null,
      },
      {
        id: "q3",
        kind: "datetime",
        question: "What date and time is the appointment?",
        options: ["Tomorrow morning"],
        about: null,
      },
    ])
    expect(result.conflicts).toEqual([
      {
        id: "conflict-1",
        draftIndex: 0,
        title: "Standup",
        startAt: "2026-05-04T09:30:00-04:00",
        endAt: "2026-05-04T10:00:00-04:00",
        existingTitle: "Dentist",
        existingStartAt: "2026-05-04T09:00:00-04:00",
        existingEndAt: "2026-05-04T09:30:00-04:00",
        existingKind: "draft",
        existingEventId: "ev-123",
        existingRecurring: false,
        assigneeId: "m-1",
        message: "Standup overlaps Dentist.",
      },
    ])
    expect(result.events[0]).toEqual({
      title: "Standup",
      description: "Zoom",
      startAt: "2026-05-04T09:30:00-04:00",
      endAt: "2026-05-04T10:00:00-04:00",
      allDay: false,
      recurrence: { freq: "weekly", count: 5 },
      reminderMinutes: 10,
      assigneeId: "m-1",
      confidence: 0.9,
    })
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string)
    expect(body).toEqual({
      text: "standup",
      image: "data:image/png;base64,abc",
      timezone: "America/Toronto",
      clarifications: [{ question: "Which day?", answer: "Friday" }],
      history: [],
      focus_event_id: null,
    })

    fetchMock.mockResolvedValueOnce(json({ model: "m" }))
    const empty = await aiApi.parse({ text: "nothing" })
    expect(empty.events).toEqual([])
    expect(empty.skipped).toBe(0)
    expect(empty.reply).toBe("")
    expect(empty.response).toBe("")
    expect(empty.reasoning).toBeNull()
    expect(empty.warnings).toEqual([])
    expect(empty.questions).toEqual([])
    expect(empty.conflicts).toEqual([])
    expect(empty.needsInput).toBe(false)
  })
})

function sse(events: { event: string; data: unknown }[]): string {
  return events.map(e => `event: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`).join("")
}

function streamResponse(chunks: string[]): Response {
  const encoder = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    },
  })
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  })
}

function resultFrame() {
  return {
    event: "result",
    data: {
      events: [],
      skipped: 0,
      model: "deepseek-v4.1-flash",
      response: '{"events": []}',
      reasoning: "Read the email.",
      warnings: [],
    },
  }
}

describe("aiApi conversations", () => {
  const apiDraft = {
    title: "Dentist",
    description: "Bring the card",
    start_at: "2026-05-15T10:00:00Z",
    end_at: "2026-05-15T11:00:00Z",
    all_day: false,
    recurrence: null,
    reminder_minutes: 30,
    assignee_id: "m1",
    confidence: 0.9,
  }
  const apiConversation = {
    id: "c1",
    title: "Dentist",
    turns: [{
      role: "assistant",
      text: "",
      image_name: null,
      raw_response: '{"events":[]}',
      reply: "Found the appointment.",
      drafts: [apiDraft],
      added: [],
      questions: [{
        id: "q1",
        kind: "datetime",
        question: "What date and time is the appointment?",
        options: [],
        about: null,
      }],
      warnings: ["Check the time", 5],
      applied: false,
      outcome: null,
    }],
    created_at: "2026-05-01T00:00:00Z",
    updated_at: "2026-05-01T00:00:00Z",
  }

  it("creates, reads and updates a saved conversation", async () => {
    fetchMock.mockResolvedValueOnce(json(apiConversation))
    const created = await aiApi.createConversation({
      title: "Dentist",
      turns: [{
        role: "assistant",
        text: "",
        imageName: "",
        rawResponse: '{"events":[]}',
        reply: "Found the appointment.",
        drafts: [{
          title: "Dentist",
          description: "Bring the card",
          startAt: "2026-05-15T10:00:00Z",
          endAt: "2026-05-15T11:00:00Z",
          allDay: false,
          recurrence: null,
          reminderMinutes: 30,
          assigneeId: "m1",
          confidence: 0.9,
        }],
        added: [],
        questions: [],
        warnings: [],
        applied: false,
        outcome: null,
      }],
    })
    expect(created.id).toBe("c1")
    expect(created.turns[0]!.drafts[0]!.startAt).toBe("2026-05-15T10:00:00Z")
    expect(created.turns[0]!.questions[0]!.kind).toBe("datetime")
    expect(created.turns[0]!.warnings).toEqual(["Check the time"])

    const postBody = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string)
    expect(postBody.turns[0].drafts[0]).toMatchObject({
      start_at: "2026-05-15T10:00:00Z",
      reminder_minutes: 30,
      assignee_id: "m1",
    })
    expect(String(fetchMock.mock.calls[0]![0])).toContain("/ai/conversations")

    fetchMock.mockResolvedValueOnce(json(apiConversation))
    await aiApi.updateConversation("c1", { title: "Dentist", turns: [] })
    expect(fetchMock.mock.calls[1]![1]!.method).toBe("PATCH")
    expect(String(fetchMock.mock.calls[1]![0])).toContain("/ai/conversations/c1")

    fetchMock.mockResolvedValueOnce(json(apiConversation))
    const loaded = await aiApi.getConversation("c1")
    expect(loaded.turns[0]!.reply).toBe("Found the appointment.")
    expect(loaded.turns[0]!.drafts[0]!.assigneeId).toBe("m1")
  })
})

describe("parseStream", () => {
  it("relays reasoning/content and resolves the result", async () => {
    const frames = sse([
      { event: "reasoning", data: { type: "reasoning", text: "Read " } },
      { event: "content", data: { type: "content", text: '{"events": [' } },
      { event: "content", data: { type: "content", text: "]}" } },
      resultFrame(),
    ])
    fetchMock.mockResolvedValueOnce(streamResponse([frames]))
    const reasoning: string[] = []
    const content: string[] = []
    const result = await parseStream(
      {
        text: "standup",
        image: null,
        clarifications: [{ question: "Which day?", answer: "Friday" }],
      },
      { onReasoning: t => reasoning.push(t), onContent: t => content.push(t) },
    )
    expect(reasoning.join("")).toBe("Read ")
    expect(content.join("")).toBe('{"events": []}')
    expect(result.response).toBe('{"events": []}')
    expect(result.reasoning).toBe("Read the email.")

    const [url, init] = fetchMock.mock.calls[0]!
    expect(String(url)).toContain("/api/v1/ai/parse/stream")
    expect((init as RequestInit).method).toBe("POST")
    expect((init as RequestInit).headers).toMatchObject({ Accept: "text/event-stream" })
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({
      clarifications: [{ question: "Which day?", answer: "Friday" }],
    })
  })

  it("handles CRLF, split chunks and a final unterminated frame", async () => {
    const frame =
      'event: result\r\ndata: {"events":[],"skipped":0,"model":"m"}\r\n\r\n'
    fetchMock.mockResolvedValueOnce(streamResponse([frame.slice(0, 20), frame.slice(20)]))
    const result = await parseStream({ text: "x" })
    expect(result.events).toEqual([])

    const unterminated = 'event: result\ndata: {"events":[],"skipped":1,"model":"m"}'
    fetchMock.mockResolvedValueOnce(streamResponse([unterminated]))
    const tail = await parseStream({ text: "x" })
    expect(tail.skipped).toBe(1)
  })

  it("ignores noise frames", async () => {
    const frames = [
      "event: ping\ndata: not-json\n\n",
      "event: reasoning\ndata: {}\n\n",
      "event: unknown\ndata: {\"text\":\"ignored\"}\n\n",
      sse([resultFrame()]),
    ].join("")
    fetchMock.mockResolvedValueOnce(streamResponse([frames]))
    const reasoning: string[] = []
    const result = await parseStream(
      { text: "x" },
      { onReasoning: text => reasoning.push(text) },
    )
    expect(reasoning).toEqual([])
    expect(result.events).toEqual([])
  })

  it("raises the server's error event", async () => {
    fetchMock.mockResolvedValueOnce(
      streamResponse([sse([{ event: "error", data: { detail: "OpenCode is down" } }])]),
    )
    await expect(parseStream({ text: "x" })).rejects.toThrow("OpenCode is down")

    fetchMock.mockResolvedValueOnce(
      streamResponse([sse([{ event: "error", data: {} }])]),
    )
    await expect(parseStream({ text: "x" })).rejects.toThrow("Smart import failed")
  })

  it("reports HTTP and network failures", async () => {
    fetchMock.mockResolvedValueOnce(json({ detail: "nope" }, 500))
    await expect(parseStream({ text: "x" })).rejects.toThrow("nope")

    fetchMock.mockResolvedValueOnce(json({}, 500))
    await expect(parseStream({ text: "x" })).rejects.toThrow("Request failed: 500")

    fetchMock.mockRejectedValueOnce(new TypeError("offline"))
    await expect(parseStream({ text: "x" })).rejects.toThrow("Could not reach the HOMST server")

    fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }))
    await expect(parseStream({ text: "x" })).rejects.toThrow("cannot read a response stream")
  })

  it("fails when the stream ends without a result", async () => {
    fetchMock.mockResolvedValueOnce(
      streamResponse([sse([{ event: "content", data: { text: "partial" } }])]),
    )
    await expect(parseStream({ text: "x" })).rejects.toThrow(
      "The model stopped before returning events",
    )
  })
})
