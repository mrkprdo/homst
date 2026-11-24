import { beforeEach, describe, expect, it, vi } from "vitest"
import { flushPromises, mount } from "@vue/test-utils"
import { nextTick } from "vue"
import AiImportPanel from "@/components/shared/AiImportPanel.vue"
import { useEvents } from "@/composables/useEvents"

const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>

const STATUS_ON = {
  configured: true,
  provider: "console",
  model: "deepseek-v4.1-flash",
  key_hint: "…abcd",
}
const STATUS_OFF = { ...STATUS_ON, configured: false, key_hint: null }

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

function install(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  fetchMock.mockReset()
  fetchMock.mockImplementation(async (url, init) => handler(String(url), init))
}

function eventResponse(body: Record<string, unknown>, index = 0) {
  return {
    id: `ev-${index}`,
    calendar_id: "cal-1",
    title: body.title,
    description: body.description ?? "",
    ai_conversation_id: body.ai_conversation_id ?? null,
    start_at: body.start_at,
    end_at: body.end_at ?? null,
    all_day: body.all_day ?? false,
    recurrence: body.recurrence ?? null,
    reminder_minutes: body.reminder_minutes ?? null,
    source: "internal",
    external_uid: null,
    assignee_id: body.assignee_id ?? null,
    created_by: null,
    created_at: "2026-05-01T00:00:00Z",
    updated_at: "2026-05-01T00:00:00Z",
  }
}

const DRAFTS = [
  {
    title: "Team standup",
    description: "Zoom",
    start_at: "2026-05-04T09:30:00-04:00",
    end_at: "2026-05-04T10:00:00-04:00",
    all_day: false,
    recurrence: { freq: "weekly", count: 5 },
    reminder_minutes: 10,
    assignee_id: "m1",
    confidence: 0.9,
  },
  {
    title: "Holiday",
    description: "",
    start_at: "2026-05-06T00:00:00-04:00",
    end_at: null,
    all_day: true,
    recurrence: { freq: "daily", until: "2026-05-08T00:00:00-04:00" },
    reminder_minutes: null,
    assignee_id: null,
    confidence: 0.4,
  },
]

interface StreamOptions {
  drafts?: unknown[]
  skipped?: number
  reply?: string
  reasoning?: string
  warnings?: string[]
  questions?: unknown[]
  conflicts?: unknown[]
  needsInput?: boolean
}

function streamed({
  drafts = DRAFTS,
  skipped = 0,
  reply = "",
  reasoning = "Reading the message",
  warnings = [],
  questions = [],
  conflicts = [],
  needsInput = false,
}: StreamOptions = {}) {
  const response = JSON.stringify({ events: drafts })
  const body = [
    `event: reasoning\ndata: ${JSON.stringify({ type: "reasoning", text: reasoning })}\n\n`,
    `event: content\ndata: ${JSON.stringify({ type: "content", text: response })}\n\n`,
    `event: result\ndata: ${JSON.stringify({
      type: "result", events: drafts, skipped, model: "deepseek-v4.1-flash",
      reply, response, reasoning, warnings, questions, conflicts, needs_input: needsInput,
    })}\n\n`,
  ].join("")
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  })
}

function progressiveStream(drafts: unknown[] = DRAFTS) {
  const encoder = new TextEncoder()
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null
  const body = new ReadableStream<Uint8Array>({
    start(streamController) {
      controller = streamController
      streamController.enqueue(encoder.encode(
        `event: reasoning\ndata: ${JSON.stringify({
          type: "reasoning",
          text: "Reading the message and checking each date.",
        })}\n\n`,
      ))
    },
  })
  const response = new Response(body, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  })
  return {
    response,
    finish() {
      const content = JSON.stringify({ events: drafts })
      controller!.enqueue(encoder.encode(
        `event: content\ndata: ${JSON.stringify({ type: "content", text: content })}\n\n` +
        `event: result\ndata: ${JSON.stringify({
          type: "result",
          events: drafts,
          skipped: 0,
          model: "deepseek-v4.1-flash",
          response: content,
          reasoning: "Reading the message and checking each date.",
          warnings: [],
        })}\n\n`,
      ))
      controller!.close()
    },
  }
}

function handlerWith(options: StreamOptions = {}) {
  return (url: string, init?: RequestInit): Response => {
    const method = init?.method ?? "GET"
    if (url.includes("/ai/conversations")) {
      return json({
        id: "conv-1",
        title: "Standup",
        turns: [],
        created_at: "2026-05-01T00:00:00Z",
        updated_at: "2026-05-01T00:00:00Z",
      })
    }
    if (url.includes("/ai/parse/stream")) return streamed(options)
    if (url.includes("/ai/parse")) {
      return json({ events: options.drafts ?? DRAFTS, model: "deepseek-v4.1-flash" })
    }
    if (url.includes("/ai")) return json(STATUS_ON)
    if (url.includes("/calendars") && method === "GET") return json([])
    if (url.includes("/calendars") && method === "POST") {
      return json({
        id: "cal-1", household_id: "h", name: "Personal", color: "sage",
        source: "internal", feed_url: null, is_visible: true, created_by: null,
      })
    }
    if (url.includes("/events") && method === "POST") {
      return json(eventResponse(JSON.parse(String(init?.body))))
    }
    return json({})
  }
}

async function mountPanel(props: Record<string, unknown> = { memberNames: { m1: "Alice" } }) {
  const wrapper = mount(AiImportPanel, { props })
  await flushPromises()
  return wrapper
}

function findButton(wrapper: ReturnType<typeof mount>, label: string) {
  return wrapper.findAll("button").find(button => button.text().includes(label))
}

async function send(wrapper: ReturnType<typeof mount>, text: string) {
  await wrapper.find(".ai-composer-input").setValue(text)
  await wrapper.find(".ai-send").trigger("click")
  await flushPromises()
}

function parseCalls() {
  return fetchMock.mock.calls.filter(call => String(call[0]).includes("/ai/parse"))
}

function parseBody(index = 0) {
  return JSON.parse((parseCalls()[index]![1] as RequestInit).body as string)
}

function addedEvents() {
  return fetchMock.mock.calls
    .filter(call => String(call[0]).endsWith("/events") && (call[1] as RequestInit)?.method === "POST")
    .map(call => JSON.parse((call[1] as RequestInit).body as string))
}

beforeEach(() => {
  vi.restoreAllMocks()
})

describe("AiImportPanel", () => {
  it("explains when Smart import is not configured", async () => {
    install(url => (url.includes("/ai") ? json(STATUS_OFF) : json({})))
    const wrapper = await mountPanel()
    expect(wrapper.text()).toContain("Smart import is off")
    expect(wrapper.text()).toContain("Settings → Smart import")
  })

  it("shows an error when the settings check fails and retries", async () => {
    let calls = 0
    install(url => {
      if (url.includes("/ai")) {
        calls += 1
        if (calls === 1) throw new TypeError("offline")
        return json(STATUS_ON)
      }
      return json({})
    })
    const wrapper = await mountPanel()
    expect(wrapper.find('[role="alert"]').text()).toContain("Couldn't check Smart import")
    await findButton(wrapper, "Try again")!.trigger("click")
    await flushPromises()
    expect(wrapper.find(".ai-composer-input").exists()).toBe(true)
    expect(wrapper.text()).toContain("What's on the schedule?")
  })

  it("sends the first message and shows the confirmation", async () => {
    install(handlerWith())
    const wrapper = await mountPanel()

    expect(wrapper.text()).toContain("What's on the schedule?")
    expect(wrapper.find(".ai-send").attributes("disabled")).toBeDefined()

    await send(wrapper, "Dinner with Sam on Friday at 7pm")

    expect(wrapper.findAll(".ai-msg--user")).toHaveLength(1)
    expect(wrapper.text()).toContain("Dinner with Sam on Friday at 7pm")
    expect(wrapper.text()).toContain("2 events ready")
    expect(wrapper.text()).toContain("Team standup")
    expect(wrapper.text()).toContain("Repeats weekly · 5 times")
    expect(wrapper.text()).toContain("10 minutes before")
    expect(wrapper.text()).toContain("For Alice")
    expect(wrapper.text()).toContain("Zoom")
    expect(wrapper.text()).toContain("Check details")
    expect(wrapper.text()).toContain("All day")
  })

  it("adds the selected drafts and emits the total when done", async () => {
    install(handlerWith({ reply: "I found two events. Check the times." }))
    const wrapper = await mountPanel()
    await send(wrapper, "Standup every Monday at 9:30")

    expect(wrapper.text()).toContain("I found two events. Check the times.")
    await wrapper.findAll(".ai-item-edit")[0]!.trigger("click")
    expect((wrapper.find(".ai-edit-title").element as HTMLInputElement).value).toBe("Team standup")
    await wrapper.findAll(".ai-item-edit")[0]!.trigger("click")
    expect(wrapper.find(".ai-item-editor").exists()).toBe(false)

    await findButton(wrapper, "Add 2 events")!.trigger("click")
    await flushPromises()

    expect(wrapper.emitted("done")).toBeUndefined()
    expect(wrapper.text()).toContain("Added 2 events")
    expect(wrapper.findAll(".ai-added-item")).toHaveLength(2)
    expect(addedEvents()).toHaveLength(2)
    expect(addedEvents()[0]).toMatchObject({
      calendar_id: "cal-1",
      title: "Team standup",
      reminder_minutes: 10,
      source_message: "Standup every Monday at 9:30",
    })

    await findButton(wrapper, "Done")!.trigger("click")
    expect(wrapper.emitted("done")).toEqual([[2]])
  })

  it("saves the conversation and links created events to it", async () => {
    const conversationBodies: Record<string, unknown>[] = []
    install((url, init) => {
      const method = init?.method ?? "GET"
      if (url.includes("/ai/conversations")) {
        conversationBodies.push(JSON.parse(String(init?.body)))
        return json({
          id: "conv-1",
          title: "Standup",
          turns: [],
          created_at: "2026-05-01T00:00:00Z",
          updated_at: "2026-05-01T00:00:00Z",
        })
      }
      if (url.includes("/ai/parse/stream")) return streamed({ reply: "Two events are ready." })
      if (url.includes("/ai")) return json(STATUS_ON)
      if (url.includes("/calendars") && method === "GET") return json([])
      if (url.includes("/calendars") && method === "POST") {
        return json({
          id: "cal-1", household_id: "h", name: "Personal", color: "sage",
          source: "internal", feed_url: null, is_visible: true, created_by: null,
        })
      }
      if (url.includes("/events") && method === "POST") {
        return json(eventResponse(JSON.parse(String(init?.body))))
      }
      return json({})
    })
    const wrapper = await mountPanel()
    await send(wrapper, "Standup every Monday at 9:30")
    await flushPromises()

    expect(conversationBodies.length).toBeGreaterThan(0)
    expect(conversationBodies[0]!.title).toBe("Standup every Monday at 9:30")
    const savedTurns = conversationBodies[0]!.turns as Array<Record<string, unknown>>
    expect(savedTurns[0]!.role).toBe("user")
    expect(savedTurns[0]!.text).toBe("Standup every Monday at 9:30")
    expect(savedTurns[1]!.role).toBe("assistant")

    await findButton(wrapper, "Add 2 events")!.trigger("click")
    await flushPromises()
    const events = addedEvents()
    expect(events).toHaveLength(2)
    expect(events[0]!.ai_conversation_id).toBe("conv-1")
    expect(events[1]!.ai_conversation_id).toBe("conv-1")
  })

  it("selects none/all and keeps the add button in sync", async () => {
    install(handlerWith())
    const wrapper = await mountPanel()
    await send(wrapper, "Standup")

    await findButton(wrapper, "Select none")!.trigger("click")
    expect(findButton(wrapper, "Add 0 events")!.attributes("disabled")).toBeDefined()
    await wrapper.find('input[type="checkbox"]').trigger("change")
    expect(findButton(wrapper, "Add 1 event")).toBeTruthy()
    await findButton(wrapper, "Select all")!.trigger("click")
    expect(findButton(wrapper, "Add 2 events")).toBeTruthy()
  })

  it("answers a question with a quick reply and keeps the conversation as history", async () => {
    let calls = 0
    install(url => {
      if (url.includes("/ai/parse/stream")) {
        calls += 1
        if (calls === 1) {
          return streamed({
            drafts: DRAFTS,
            reply: "Who is Team standup for?",
            questions: [{
              id: "q1",
              kind: "assignee",
              question: "Who is Team standup for?",
              options: ["Alice", "Bob"],
              about: "Team standup",
            }],
            needsInput: true,
          })
        }
        return streamed({ drafts: DRAFTS, reply: "I've assigned it to Alice." })
      }
      if (url.includes("/ai")) return json(STATUS_ON)
      return json({})
    })
    const wrapper = await mountPanel({ memberNames: { m1: "Alice", m2: "Bob" } })
    await send(wrapper, "Standup")

    expect(wrapper.text()).toContain("Who is Team standup for?")
    await findButton(wrapper, "Alice")!.trigger("click")
    await flushPromises()

    expect(wrapper.text()).toContain("I've assigned it to Alice.")
    expect(wrapper.findAll(".ai-msg--user")).toHaveLength(2)
    const body = parseBody(1)
    expect(body.clarifications).toEqual([
      { question: "Who is Team standup for?", answer: "Alice" },
    ])
    expect(body.history).toEqual([
      { role: "user", text: "Standup" },
      { role: "assistant", text: JSON.stringify({ events: DRAFTS }) },
    ])
  })

  it("asks for a precise date and time with a date picker and time dropdown", async () => {
    let calls = 0
    install(url => {
      if (url.includes("/ai/parse/stream")) {
        calls += 1
        if (calls === 1) {
          return streamed({
            drafts: [],
            reply: "What date and time is the dog's neuter appointment?",
            questions: [{
              id: "q1",
              kind: "datetime",
              question: "What date and time is the dog's neuter appointment?",
              options: [],
            }],
            needsInput: true,
          })
        }
        return streamed({ drafts: DRAFTS, reply: "The appointment is on the calendar." })
      }
      if (url.includes("/ai")) return json(STATUS_ON)
      return json({})
    })
    const wrapper = await mountPanel()
    await send(wrapper, "Dog neuter appointment")

    expect(wrapper.text()).toContain("What date and time is the dog's neuter appointment?")
    expect(wrapper.text()).not.toContain("Tomorrow morning")
    expect(wrapper.find('.ai-datetime input[type="date"]').exists()).toBe(true)
    expect(wrapper.find(".ai-datetime select").exists()).toBe(true)

    const confirm = findButton(wrapper, "Confirm date and time")!
    expect(confirm.attributes("disabled")).toBeDefined()

    await wrapper.find('.ai-datetime input[type="date"]').setValue("2026-11-27")
    await wrapper.find(".ai-datetime select").setValue("09:00")
    expect(confirm.attributes("disabled")).toBeUndefined()
    await confirm.trigger("click")
    await flushPromises()

    const body = parseBody(1)
    expect(body.clarifications).toHaveLength(1)
    expect(body.clarifications[0].question).toBe("What date and time is the dog's neuter appointment?")
    expect(body.clarifications[0].answer).toContain("2026")
    expect(body.clarifications[0].answer).toContain("9:00")
    expect(wrapper.text()).toContain(body.clarifications[0].answer)
    expect(wrapper.text()).toContain("The appointment is on the calendar.")
  })

  it("reopens a saved thread from an event and updates that event", async () => {
    const existingDraft = {
      title: "Dentist",
      description: "Bring the insurance card",
      start_at: "2026-05-15T15:00:00Z",
      end_at: "2026-05-15T16:00:00Z",
      all_day: false,
      recurrence: null,
      reminder_minutes: null,
      assignee_id: null,
      confidence: 0.9,
    }
    const updatedDraft = {
      ...existingDraft,
      start_at: "2026-05-15T16:00:00Z",
      end_at: "2026-05-15T17:00:00Z",
    }
    const storedConversation = {
      id: "conv-1",
      title: "Dentist Friday at 3",
      turns: [
        {
          role: "user",
          text: "Dentist Friday at 3",
          image_name: null,
          raw_response: null,
          reply: null,
          drafts: [],
          added: [],
          questions: [],
          warnings: [],
          applied: false,
          outcome: null,
        },
        {
          role: "assistant",
          text: "",
          image_name: null,
          raw_response: '{"events":[{"title":"Dentist"}]}',
          reply: "The dentist is booked.",
          drafts: [],
          added: [existingDraft],
          questions: [],
          warnings: [],
          applied: true,
          outcome: "success",
        },
      ],
      created_at: "2026-05-01T00:00:00Z",
      updated_at: "2026-05-01T00:00:00Z",
    }

    useEvents().upsertEvent({
      id: "ev-1", calendarId: "cal-1", title: "Dentist",
      description: "Bring the insurance card",
      sourceMessage: "Dentist Friday at 3",
      aiConversationId: "conv-1",
      startAt: "2026-05-15T15:00:00Z", endAt: "2026-05-15T16:00:00Z",
      allDay: false, recurrence: null, source: "internal",
      externalUid: null, createdBy: null, createdAt: "", updatedAt: "",
    })

    let updatedBody: Record<string, unknown> | null = null
    install((url, init) => {
      const method = init?.method ?? "GET"
      if (url.includes("/ai/conversations/conv-1")) {
        return json(method === "GET" ? storedConversation : { ...storedConversation, updated_at: "2026-05-02T00:00:00Z" })
      }
      if (url.includes("/ai/parse/stream")) {
        return streamed({
          drafts: [updatedDraft, { ...updatedDraft, title: "Extra event" }],
          reply: "Moved to 4 PM.",
        })
      }
      if (url.includes("/ai")) return json(STATUS_ON)
      if (url.includes("/events/ev-1") && method === "PATCH") {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>
        updatedBody = body
        return json(eventResponse(body))
      }
      return json({})
    })

    const wrapper = await mountPanel({
      memberNames: {},
      conversationId: "conv-1",
      focusEventId: "ev-1",
    })

    expect(wrapper.text()).toContain("Updating")
    expect(wrapper.text()).toContain("Dentist")
    expect(wrapper.text()).toContain("Dentist Friday at 3")
    expect(wrapper.text()).toContain("The dentist is booked.")
    expect(wrapper.text()).toContain("Event updated")
    expect(findButton(wrapper, "Add another")).toBeUndefined()

    await send(wrapper, "Actually make it 4 PM")
    await flushPromises()

    expect(wrapper.text()).toContain("Moved to 4 PM.")
    expect(wrapper.findAll(".ai-item")).toHaveLength(1)
    expect(wrapper.text()).not.toContain("Extra event")

    const body = parseBody(0)
    expect(body.focus_event_id).toBe("ev-1")
    expect(body.history).toEqual([
      { role: "user", text: "Dentist Friday at 3" },
      { role: "assistant", text: '{"events":[{"title":"Dentist"}]}' },
    ])

    await findButton(wrapper, "Update event")!.trigger("click")
    await flushPromises()

    expect(updatedBody).toMatchObject({
      title: "Dentist",
      start_at: "2026-05-15T16:00:00Z",
      end_at: "2026-05-15T17:00:00Z",
      ai_conversation_id: "conv-1",
    })
    expect(wrapper.text()).toContain("Done — the event is updated.")
    expect(wrapper.text()).toContain("Event updated")
    const posts = fetchMock.mock.calls.filter(
      call => String(call[0]).endsWith("/events") && (call[1] as RequestInit)?.method === "POST",
    )
    expect(posts).toHaveLength(0)
  })

  it("starts a chat from an older event's original message", async () => {
    let patchedBody: Record<string, unknown> | null = null
    install((url, init) => {
      const method = init?.method ?? "GET"
      if (url.includes("/ai/conversations")) {
        return json({
          id: "conv-new",
          title: "Bring the card on Friday",
          turns: [],
          created_at: "2026-05-01T00:00:00Z",
          updated_at: "2026-05-01T00:00:00Z",
        })
      }
      if (url.includes("/ai/parse/stream")) {
        return streamed({ drafts: [DRAFTS[0]], reply: "Moved to 4 PM." })
      }
      if (url.includes("/ai")) return json(STATUS_ON)
      if (url.includes("/events/ev-old") && method === "PATCH") {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>
        patchedBody = body
        return json(eventResponse(body))
      }
      return json({})
    })

    const wrapper = await mountPanel({
      memberNames: {},
      focusEventId: "ev-old",
      focusEventTitle: "Old dentist",
      focusSourceMessage: "Bring the card on Friday",
    })

    expect(wrapper.text()).toContain("Updating")
    expect(wrapper.text()).toContain("Old dentist")
    expect(wrapper.text()).toContain("No saved chat history for this event")
    expect(wrapper.text()).toContain("Bring the card on Friday")

    await send(wrapper, "Make it 4 PM")
    await flushPromises()

    const body = parseBody(0)
    expect(body.focus_event_id).toBe("ev-old")
    expect(body.history).toEqual([
      { role: "user", text: "Bring the card on Friday" },
    ])

    await findButton(wrapper, "Update event")!.trigger("click")
    await flushPromises()

    expect(patchedBody).toMatchObject({
      title: "Team standup",
      ai_conversation_id: "conv-new",
    })
    expect(wrapper.text()).toContain("Done — the event is updated.")
  })

  it("invites a change when an event has no saved chat or source message", async () => {
    install(url => {
      if (url.includes("/ai")) return json(STATUS_ON)
      return json({})
    })
    const wrapper = await mountPanel({
      memberNames: {},
      focusEventId: "ev-empty",
      focusEventTitle: "Gym session",
    })

    expect(wrapper.text()).toContain("Updating")
    expect(wrapper.text()).toContain("Gym session")
    expect(wrapper.text()).toContain("No chat history for this event")
    expect(wrapper.text()).toContain("You can still tell me what to change")
    expect(wrapper.find(".ai-composer-input").exists()).toBe(true)
  })

  it("refines drafts over several turns and marks superseded cards", async () => {
    install(handlerWith({ reply: "Two events are ready." }))
    const wrapper = await mountPanel()
    await send(wrapper, "Standup at 9:30")

    expect(wrapper.text()).toContain("2 events ready")
    await send(wrapper, "Make it 10:30")
    await flushPromises()

    expect(wrapper.findAll(".ai-msg--user")).toHaveLength(2)
    expect(wrapper.text()).toContain("2 events were not added.")
    expect(wrapper.text()).toContain("Make it 10:30")
    const body = parseBody(1)
    expect(body.text).toBe("Make it 10:30")
    expect(body.history).toEqual([
      { role: "user", text: "Standup at 9:30" },
      { role: "assistant", text: JSON.stringify({ events: DRAFTS }) },
    ])
  })

  it("attaches photos from the picker, paste and drop", async () => {
    install(handlerWith())
    const wrapper = await mountPanel()

    const input = wrapper.find('input[type="file"]')
    const file = new File([new Uint8Array([1, 2, 3])], "shot.png", { type: "image/png" })
    Object.defineProperty(input.element, "files", { value: [file], configurable: true })
    await input.trigger("change")
    await vi.waitFor(() => expect(wrapper.text()).toContain("shot.png"))
    await wrapper.find(".ai-attachment-clear").trigger("click")
    expect(wrapper.text()).not.toContain("shot.png")

    await wrapper.find(".ai-import").trigger("paste", { clipboardData: { files: [file] } })
    await vi.waitFor(() => expect(wrapper.text()).toContain("shot.png"))
    await wrapper.find(".ai-attachment-clear").trigger("click")

    await wrapper.find(".ai-import").trigger("dragover")
    expect(wrapper.find(".ai-drop-hint").exists()).toBe(true)
    await wrapper.find(".ai-import").trigger("dragleave")
    await wrapper.find(".ai-import").trigger("drop", { dataTransfer: { files: [file] } })
    await vi.waitFor(() => expect(wrapper.text()).toContain("shot.png"))

    await send(wrapper, "Dinner Friday")
    const body = parseBody()
    expect(body.image).toContain("data:image/png;base64,")
    expect(body.text).toBe("Dinner Friday")

    await findButton(wrapper, "Add 2 events")!.trigger("click")
    await flushPromises()
    const source = addedEvents()[0]!.source_message as string
    expect(source).toContain("Dinner Friday")
    expect(source).toContain("[Image: shot.png]")
  })

  it("ignores unusable files", async () => {
    install(handlerWith())
    const wrapper = await mountPanel()
    const input = wrapper.find('input[type="file"]')

    const text = new File(["hello"], "notes.txt", { type: "text/plain" })
    Object.defineProperty(input.element, "files", { value: [text], configurable: true })
    await input.trigger("change")
    expect(wrapper.text()).toContain("Choose a PNG, JPEG, WebP or GIF image")

    const huge = new File([new Uint8Array(9 * 1024 * 1024)], "huge.png", { type: "image/png" })
    Object.defineProperty(input.element, "files", { value: [huge], configurable: true })
    await input.trigger("change")
    expect(wrapper.text()).toContain("larger than 8 MB")
    expect(wrapper.find(".ai-attachment").exists()).toBe(false)
  })

  it("reports parse failures and retries the same message", async () => {
    let calls = 0
    install((url) => {
      if (url.includes("/ai/parse/stream")) {
        calls += 1
        if (calls <= 2) return json({ detail: "OpenCode is down" }, 500)
        return streamed()
      }
      if (url.includes("/ai")) return json(STATUS_ON)
      return json({})
    })
    const wrapper = await mountPanel()
    await send(wrapper, "Standup")

    expect(wrapper.find('[role="alert"]').text()).toContain("OpenCode is down")
    await findButton(wrapper, "Try again")!.trigger("click")
    await flushPromises()
    expect(wrapper.find('[role="alert"]').text()).toContain("OpenCode is down")

    await findButton(wrapper, "Try again")!.trigger("click")
    await flushPromises()
    expect(wrapper.text()).not.toContain("OpenCode is down")
    expect(wrapper.text()).toContain("2 events ready")
    expect(wrapper.findAll(".ai-msg--user")).toHaveLength(1)
  })

  it("reports empty results with skipped rows and offers manual entry", async () => {
    install(handlerWith({ drafts: [], skipped: 2, reply: "I couldn't find a dated event." }))
    const wrapper = await mountPanel()
    await send(wrapper, "Newsletter")

    expect(wrapper.text()).toContain("I couldn't find a dated event.")
    expect(wrapper.text()).toContain("Worth checking")
    expect(wrapper.text()).toContain("2 entries couldn't be turned into an event")
    expect(findButton(wrapper, "Add manually")).toBeTruthy()
    await findButton(wrapper, "Add manually")!.trigger("click")
    expect(wrapper.emitted("manual")).toHaveLength(1)
  })

  it("renders repeat fallbacks and a plain empty response", async () => {
    install(handlerWith({
      drafts: [{ ...DRAFTS[0], title: "Odd rota", recurrence: { freq: "hourly" } }],
    }))
    const wrapper = await mountPanel()
    await send(wrapper, "Odd rota")
    expect(wrapper.text()).toContain("Repeats hourly")

    install(handlerWith({ drafts: [], reply: "" }))
    const empty = await mountPanel()
    await send(empty, "Nothing dated")
    expect(empty.text()).toContain("I couldn't find a dated event in that.")
  })

  it("offers the updated event when the model gives no reply", async () => {
    install(handlerWith({ drafts: [DRAFTS[0]], reply: "" }))
    const wrapper = await mountPanel({ focusEventId: "ev-1", focusEventTitle: "Dentist" })
    await send(wrapper, "Move it")
    expect(wrapper.text()).toContain("Here's the updated event. Check the changes, then save.")
    expect(findButton(wrapper, "Update event")).toBeTruthy()
  })

  it("shows a retry when a saved conversation cannot be loaded", async () => {
    let loads = 0
    install(url => {
      if (url.includes("/ai/conversations/conv-1")) {
        loads += 1
        if (loads === 1) return json({ detail: "offline" }, 500)
        return json({
          id: "conv-1",
          title: "Dentist",
          turns: [{
            role: "user",
            text: "Dentist Friday at 3",
            image_name: null,
            raw_response: null,
            reply: null,
            drafts: [],
            added: [],
            questions: [],
            warnings: [],
            applied: false,
            outcome: null,
          }],
          created_at: "2026-05-01T00:00:00Z",
          updated_at: "2026-05-01T00:00:00Z",
        })
      }
      if (url.includes("/ai")) return json(STATUS_ON)
      return json({})
    })

    const wrapper = await mountPanel({ conversationId: "conv-1" })
    expect(wrapper.text()).toContain("Couldn't open this conversation")
    await findButton(wrapper, "Try again")!.trigger("click")
    await flushPromises()
    expect(wrapper.text()).toContain("Dentist Friday at 3")
  })

  it("opens the image picker from the plus button", async () => {
    install(url => (url.includes("/ai") ? json(STATUS_ON) : json({})))
    const wrapper = await mountPanel()
    const click = vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => {})
    await wrapper.find(".ai-attach").trigger("click")
    expect(click).toHaveBeenCalled()
  })

  it("falls back to draft and question text when a saved reply is missing", async () => {
    install(url => {
      if (url.includes("/ai/conversations/conv-1")) {
        return json({
          id: "conv-1",
          title: "Original request",
          turns: [
            {
              role: "user",
              text: "Original request",
              image_name: null,
              raw_response: null,
              reply: null,
              drafts: [],
              added: [],
              questions: [],
              warnings: [],
              applied: false,
              outcome: null,
            },
            {
              role: "assistant",
              text: "",
              image_name: null,
              raw_response: null,
              reply: "",
              drafts: [DRAFTS[0]],
              added: [],
              questions: [],
              warnings: [],
              applied: false,
              outcome: null,
            },
            {
              role: "assistant",
              text: "",
              image_name: null,
              raw_response: null,
              reply: "",
              drafts: [],
              added: [],
              questions: [{
                id: "q1",
                kind: "clarification",
                question: "Which week?",
                options: [],
                about: null,
              }],
              warnings: [],
              applied: false,
              outcome: null,
            },
            {
              role: "assistant",
              text: "",
              image_name: null,
              raw_response: null,
              reply: "",
              drafts: [],
              added: [],
              questions: [],
              warnings: [],
              applied: false,
              outcome: null,
            },
          ],
          created_at: "2026-05-01T00:00:00Z",
          updated_at: "2026-05-01T00:00:00Z",
        })
      }
      if (url.includes("/ai/parse/stream")) return streamed({ reply: "Sure." })
      if (url.includes("/ai")) return json(STATUS_ON)
      return json({})
    })

    const wrapper = await mountPanel({ conversationId: "conv-1" })
    await send(wrapper, "Change it")
    const body = parseBody(0)
    const assistantHistory = (body.history as Array<{ role: string; text: string }>)
      .filter(message => message.role === "assistant")
    expect(assistantHistory[0]!.text).toContain("I proposed these events:")
    expect(assistantHistory[1]!.text).toBe("Which week?")
    expect(assistantHistory).toHaveLength(2)
  })

  it("stops before saving when the conversation cannot be persisted", async () => {
    install((url, init) => {
      const method = init?.method ?? "GET"
      if (url.includes("/ai/conversations")) return json({ detail: "nope" }, 500)
      if (url.includes("/ai/parse/stream")) return streamed()
      if (url.includes("/ai")) return json(STATUS_ON)
      if (url.includes("/calendars") && method === "GET") return json([])
      if (url.includes("/calendars") && method === "POST") {
        return json({
          id: "cal-1", household_id: "h", name: "Personal", color: "sage",
          source: "internal", feed_url: null, is_visible: true, created_by: null,
        })
      }
      if (url.includes("/events")) return json(eventResponse({}))
      return json({})
    })

    const wrapper = await mountPanel()
    await send(wrapper, "Standup")
    await findButton(wrapper, "Add 2 events")!.trigger("click")
    await flushPromises()

    expect(wrapper.text()).toContain("Couldn't save this conversation")
    expect(addedEvents()).toHaveLength(0)
    expect(findButton(wrapper, "Add 2 events")).toBeTruthy()
  })

  it("keeps the event when an update save fails", async () => {
    install((url, init) => {
      const method = init?.method ?? "GET"
      if (url.includes("/ai/conversations")) {
        return json({
          id: "conv-1",
          title: "Dentist",
          turns: [],
          created_at: "2026-05-01T00:00:00Z",
          updated_at: "2026-05-01T00:00:00Z",
        })
      }
      if (url.includes("/ai/parse/stream")) return streamed({ drafts: [DRAFTS[0]], reply: "Moved." })
      if (url.includes("/ai")) return json(STATUS_ON)
      if (url.includes("/events/ev-1") && method === "PATCH") {
        return json({ detail: "nope" }, 500)
      }
      return json({})
    })

    const wrapper = await mountPanel({ focusEventId: "ev-1", focusEventTitle: "Dentist" })
    await send(wrapper, "Move it")
    await findButton(wrapper, "Update event")!.trigger("click")
    await flushPromises()

    expect(wrapper.text()).toContain("The event wasn't updated.")
    expect(findButton(wrapper, "Update event")).toBeTruthy()
  })

  it("opens the time editor from a conflict", async () => {
    install(handlerWith({
      conflicts: [{
        id: "conflict-1",
        draft_index: 0,
        title: DRAFTS[0]!.title,
        start_at: DRAFTS[0]!.start_at,
        existing_title: "Dentist",
        existing_start_at: "2026-05-04T09:00:00-04:00",
        existing_kind: "existing",
        existing_event_id: "ev-old",
        message: "Team standup overlaps Dentist.",
      }],
    }))
    const wrapper = await mountPanel()
    await send(wrapper, "Standup")
    await findButton(wrapper, "Change time")!.trigger("click")
    expect(wrapper.find(".ai-item-editor").exists()).toBe(true)
    await findButton(wrapper, "Cancel")!.trigger("click")
    expect(findButton(wrapper, "Add 2 events")!.attributes("disabled")).toBeUndefined()
  })

  it("reports when the replaced event cannot be removed", async () => {
    install((url, init) => {
      const method = init?.method ?? "GET"
      if (url.includes("/ai/conversations")) {
        return json({
          id: "conv-1",
          title: "Standup",
          turns: [],
          created_at: "2026-05-01T00:00:00Z",
          updated_at: "2026-05-01T00:00:00Z",
        })
      }
      if (url.includes("/ai/parse/stream")) {
        return streamed({
          drafts: [DRAFTS[0]],
          conflicts: [{
            id: "conflict-1",
            draft_index: 0,
            title: DRAFTS[0]!.title,
            start_at: DRAFTS[0]!.start_at,
            existing_title: "Dentist",
            existing_start_at: "2026-05-04T09:00:00-04:00",
            existing_kind: "existing",
            existing_event_id: "ev-old",
            message: "Team standup overlaps Dentist.",
          }],
        })
      }
      if (url.includes("/ai")) return json(STATUS_ON)
      if (url.includes("/calendars") && method === "GET") return json([])
      if (url.includes("/calendars") && method === "POST") {
        return json({
          id: "cal-1", household_id: "h", name: "Personal", color: "sage",
          source: "internal", feed_url: null, is_visible: true, created_by: null,
        })
      }
      if (url.includes("/events/ev-old") && method === "DELETE") {
        return json({ detail: "nope" }, 500)
      }
      if (url.includes("/events") && method === "POST") {
        return json(eventResponse(JSON.parse(String(init?.body))))
      }
      return json({})
    })

    const wrapper = await mountPanel()
    await send(wrapper, "Standup")
    await findButton(wrapper, "Replace existing")!.trigger("click")
    await findButton(wrapper, "Add 1 event")!.trigger("click")
    await flushPromises()

    expect(wrapper.text()).toContain("Added the new event, but couldn't remove")
    expect(wrapper.text()).toContain("Added 1 event")
  })

  it("shows progress while the model streams, without showing raw JSON", async () => {
    const stream = progressiveStream()
    install(url => {
      if (url.includes("/ai/parse/stream")) return stream.response
      if (url.includes("/ai")) return json(STATUS_ON)
      return json({})
    })
    const wrapper = await mountPanel()
    await send(wrapper, "Standup")

    expect(wrapper.text()).toContain("Reading that…")
    expect(wrapper.find(".ai-typing").exists()).toBe(true)
    expect(wrapper.text()).not.toContain("2 events ready")
    expect(wrapper.text()).not.toContain('"events"')

    stream.finish()
    await flushPromises()
    expect(wrapper.text()).toContain("2 events ready")
    expect(wrapper.text()).not.toContain("How I read it")
    expect(wrapper.text()).not.toContain("Reading the message and checking each date.")
  })

  it("edits a draft before adding it", async () => {
    install(handlerWith())
    const wrapper = await mountPanel()
    await send(wrapper, "Standup")

    expect(wrapper.find(".ai-item--low").exists()).toBe(true)
    await wrapper.findAll(".ai-item-edit")[1]!.trigger("click")
    await wrapper.find(".ai-edit-title").setValue("Holiday (school closed)")
    await wrapper.find('.ai-edit-toggle input[type="checkbox"]').setValue(false)
    await nextTick()
    const times = wrapper.findAll('.ai-item--editing input[type="time"]')
    await times[0]!.setValue("09:15")
    await findButton(wrapper, "Save changes")!.trigger("click")
    await flushPromises()

    expect(wrapper.find(".ai-item--low").exists()).toBe(false)
    expect(wrapper.find(".ai-item-editor").exists()).toBe(false)

    await findButton(wrapper, "Add 2 events")!.trigger("click")
    await flushPromises()
    const edited = addedEvents().find(body => body.title === "Holiday (school closed)")
    expect(edited!.start_at).toBe(new Date("2026-05-06T09:15").toISOString())
    expect(edited!.end_at).toBe(new Date("2026-05-06T10:15").toISOString())
    expect(edited!.all_day).toBe(false)
  })

  it("validates the inline editor", async () => {
    install(handlerWith())
    const wrapper = await mountPanel()
    await send(wrapper, "Standup")

    await wrapper.findAll(".ai-item-edit")[1]!.trigger("click")
    const title = wrapper.find(".ai-edit-title")
    await title.setValue("")
    expect(wrapper.text()).toContain("Add a title.")
    expect(findButton(wrapper, "Save changes")!.attributes("disabled")).toBeDefined()

    await title.setValue("Holiday")
    let dates = wrapper.findAll('.ai-item--editing input[type="date"]')
    await dates[0]!.setValue("2026-05-07")
    await dates[1]!.setValue("2026-05-01")
    expect(wrapper.text()).toContain("The end date can't be before the start date.")

    dates = wrapper.findAll('.ai-item--editing input[type="date"]')
    await dates[1]!.setValue("")
    await wrapper.find('.ai-edit-toggle input[type="checkbox"]').setValue(false)
    await nextTick()
    const times = wrapper.findAll('.ai-item--editing input[type="time"]')
    await times[1]!.setValue("07:00")
    expect(wrapper.text()).toContain("The end time must be after the start time.")

    await wrapper.find('.ai-edit-toggle input[type="checkbox"]').setValue(true)
    await nextTick()
    dates = wrapper.findAll('.ai-item--editing input[type="date"]')
    await dates[1]!.setValue("2026-05-08")
    await findButton(wrapper, "Save changes")!.trigger("click")
    await flushPromises()

    expect(wrapper.find(".ai-item--low").exists()).toBe(false)
    await findButton(wrapper, "Add 2 events")!.trigger("click")
    await flushPromises()
    const edited = addedEvents().find(body => body.title === "Holiday")
    expect(edited!.all_day).toBe(true)
    expect(new Date(edited!.end_at as string).toISOString())
      .toBe(new Date("2026-05-08T23:59:59").toISOString())
  })

  it("reports when none of the drafts can be saved", async () => {
    install((url, init) => {
      const method = init?.method ?? "GET"
      if (url.includes("/ai/parse/stream")) return streamed()
      if (url.includes("/ai")) return json(STATUS_ON)
      if (url.includes("/calendars") && method === "GET") return json([])
      if (url.includes("/calendars") && method === "POST") {
        return json({
          id: "cal-1", household_id: "h", name: "Personal", color: "sage",
          source: "internal", feed_url: null, is_visible: true, created_by: null,
        })
      }
      if (url.includes("/events")) return json({ detail: "nope" }, 500)
      return json({})
    })
    const wrapper = await mountPanel()
    await send(wrapper, "Standup")

    await findButton(wrapper, "Add 2 events")!.trigger("click")
    await flushPromises()
    expect(wrapper.text()).toContain("No events were added")
    expect(findButton(wrapper, "Add 2 events")).toBeTruthy()
    expect(wrapper.emitted("done")).toBeUndefined()
  })

  it("reports a partial failure and keeps the failed draft for a retry", async () => {
    let eventCalls = 0
    install((url, init) => {
      const method = init?.method ?? "GET"
      if (url.includes("/ai/parse/stream")) return streamed()
      if (url.includes("/ai")) return json(STATUS_ON)
      if (url.includes("/calendars") && method === "GET") return json([])
      if (url.includes("/calendars") && method === "POST") {
        return json({
          id: "cal-1", household_id: "h", name: "Personal", color: "sage",
          source: "internal", feed_url: null, is_visible: true, created_by: null,
        })
      }
      if (url.includes("/events") && method === "POST") {
        eventCalls += 1
        if (eventCalls === 2) return json({ detail: "nope" }, 500)
        return json(eventResponse(JSON.parse(String(init?.body))))
      }
      return json({})
    })
    const wrapper = await mountPanel()
    await send(wrapper, "Standup")
    await findButton(wrapper, "Add 2 events")!.trigger("click")
    await flushPromises()

    expect(wrapper.text()).toContain("Added 1 event. 1 couldn't be saved.")
    expect(wrapper.findAll(".ai-added-item")).toHaveLength(1)
    expect(findButton(wrapper, "Add 1 event")).toBeTruthy()
    expect(findButton(wrapper, "Done")).toBeUndefined()
  })

  it("shows extraction warnings with the drafts", async () => {
    install(handlerWith({
      warnings: [
        "The message may list 30 dated items, but only 2 were found. Check for missing events.",
      ],
    }))
    const wrapper = await mountPanel()
    await send(wrapper, "Lunch schedule")
    expect(wrapper.find(".ai-warnings").text()).toContain("only 2 were found")
  })

  it("blocks adding while a schedule conflict is unresolved", async () => {
    const conflict = {
      id: "conflict-1",
      draft_index: 0,
      title: DRAFTS[0]!.title,
      start_at: DRAFTS[0]!.start_at,
      existing_title: "Dentist",
      existing_start_at: "2026-05-04T09:00:00-04:00",
      existing_kind: "existing",
      message: "Team standup overlaps an existing event.",
    }
    install(handlerWith({ conflicts: [conflict] }))
    const wrapper = await mountPanel()
    await send(wrapper, "Standup")

    expect(wrapper.text()).toContain("Schedule conflict")
    expect(findButton(wrapper, "Add 2 events")!.attributes("disabled")).toBeDefined()
    expect(wrapper.text()).toContain("Resolve the conflicts first.")

    await findButton(wrapper, "Keep both")!.trigger("click")
    expect(findButton(wrapper, "Add 2 events")!.attributes("disabled")).toBeUndefined()
  })

  it("replaces the conflicting existing event only after the new one is saved", async () => {
    const calls: string[] = []
    install((url, init) => {
      const method = init?.method ?? "GET"
      if (url.includes("/ai/conversations")) {
        return json({
          id: "conv-1",
          title: "Standup",
          turns: [],
          created_at: "2026-05-01T00:00:00Z",
          updated_at: "2026-05-01T00:00:00Z",
        })
      }
      if (url.includes("/ai/parse/stream")) {
        return streamed({
          conflicts: [
            {
              id: "conflict-1",
              draft_index: 0,
              title: DRAFTS[0]!.title,
              start_at: DRAFTS[0]!.start_at,
              existing_title: "Dentist",
              existing_start_at: "2026-05-04T09:00:00-04:00",
              existing_kind: "existing",
              existing_event_id: "ev-old",
              message: "Team standup overlaps Dentist.",
            },
            {
              id: "conflict-2",
              draft_index: 1,
              title: DRAFTS[1]!.title,
              start_at: DRAFTS[1]!.start_at,
              existing_title: "Dentist",
              existing_start_at: "2026-05-04T09:00:00-04:00",
              existing_kind: "existing",
              existing_event_id: "ev-old",
              message: "Holiday overlaps Dentist.",
            },
          ],
        })
      }
      if (url.includes("/ai")) return json(STATUS_ON)
      if (url.includes("/calendars") && method === "GET") return json([])
      if (url.includes("/calendars") && method === "POST") {
        return json({
          id: "cal-1", household_id: "h", name: "Personal", color: "sage",
          source: "internal", feed_url: null, is_visible: true, created_by: null,
        })
      }
      if (url.includes("/events/ev-old") && method === "DELETE") {
        calls.push("delete")
        return new Response(null, { status: 204 })
      }
      if (url.includes("/events") && method === "POST") {
        calls.push("create")
        return json(eventResponse(JSON.parse(String(init?.body))))
      }
      return json({})
    })
    const wrapper = await mountPanel()
    await send(wrapper, "Standup")

    expect(wrapper.text()).toContain("Schedule conflicts")
    const replaceButtons = () =>
      wrapper.findAll("button").filter(button => button.text().includes("Replace existing"))

    await replaceButtons()[0]!.trigger("click")
    expect(wrapper.findAll(".ai-conflict")).toHaveLength(1)
    expect(wrapper.text()).toContain("Will be removed when saved")

    // Undo the replacement, then replace both drafts that hit the same event.
    await findButton(wrapper, "Keep it")!.trigger("click")
    expect(wrapper.findAll(".ai-conflict")).toHaveLength(2)
    await replaceButtons()[0]!.trigger("click")
    await replaceButtons()[0]!.trigger("click")
    expect(wrapper.findAll(".ai-conflict")).toHaveLength(0)
    expect(wrapper.findAll(".ai-replacement")).toHaveLength(2)

    await findButton(wrapper, "Add 2 events")!.trigger("click")
    await flushPromises()

    expect(calls.filter(call => call === "create")).toHaveLength(2)
    expect(calls.filter(call => call === "delete")).toHaveLength(1)
    expect(wrapper.text()).toContain("Added 2 events")
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
  })

  it("resets the conversation with New chat", async () => {
    install(handlerWith())
    const wrapper = await mountPanel()
    await send(wrapper, "Standup")
    expect(wrapper.text()).toContain("2 events ready")

    await findButton(wrapper, "New chat")!.trigger("click")
    expect(wrapper.text()).toContain("What's on the schedule?")
    expect(wrapper.text()).not.toContain("2 events ready")
    expect((wrapper.find(".ai-composer-input").element as HTMLTextAreaElement).value).toBe("")
  })

  it("sends on Enter but leaves Shift+Enter for a new line", async () => {
    install(handlerWith())
    const wrapper = await mountPanel()
    const input = wrapper.find(".ai-composer-input")

    await input.setValue("Dinner Friday")
    await input.trigger("keydown", { key: "Enter", shiftKey: true })
    await flushPromises()
    expect(parseCalls()).toHaveLength(0)

    await input.trigger("keydown", { key: "Enter" })
    await flushPromises()
    expect(parseCalls()).toHaveLength(1)
  })

  it("edits who an event is for", async () => {
    install(handlerWith())
    const wrapper = await mountPanel({ memberNames: { m2: "Bob", m1: "Alice", m3: "" } })
    await send(wrapper, "Standup")

    await wrapper.findAll(".ai-item-edit")[1]!.trigger("click")
    const select = wrapper.find(".ai-item--editing select")
    expect(select.findAll("option").map(option => option.text())).toEqual(["No one", "Alice", "Bob"])
    await select.setValue("m2")
    await findButton(wrapper, "Save changes")!.trigger("click")
    await flushPromises()

    expect(wrapper.text()).toContain("For Bob")
    await findButton(wrapper, "Add 2 events")!.trigger("click")
    await flushPromises()
    const holiday = addedEvents().find(body => body.title === "Holiday")
    expect(holiday!.assignee_id).toBe("m2")
  })
})
