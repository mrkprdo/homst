import { beforeEach, describe, expect, it, vi } from "vitest"
import { flushPromises, mount } from "@vue/test-utils"
import { nextTick } from "vue"
import AiImportPanel from "@/components/shared/AiImportPanel.vue"

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

function streamed(
  drafts: unknown[] = DRAFTS,
  skipped = 0,
  reasoning = "Reading the message",
  warnings: string[] = [],
) {
  const response = JSON.stringify({ events: drafts })
  const body = [
    `event: reasoning\ndata: ${JSON.stringify({ type: "reasoning", text: reasoning })}\n\n`,
    `event: content\ndata: ${JSON.stringify({ type: "content", text: response })}\n\n`,
    `event: result\ndata: ${JSON.stringify({
      type: "result", events: drafts, skipped, model: "deepseek-v4.1-flash",
      response, reasoning, warnings,
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

function handlerWith(drafts: unknown[] = DRAFTS, skipped = 0) {
  return (url: string, init?: RequestInit): Response => {
    const method = init?.method ?? "GET"
    if (url.includes("/ai/parse/stream")) return streamed(drafts, skipped)
    if (url.includes("/ai/parse")) return json({ events: drafts, skipped, model: "deepseek-v4.1-flash" })
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
    expect(wrapper.find("#ai-context").exists()).toBe(true)
  })

  it("parses text, previews drafts and creates the selected events", async () => {
    install(handlerWith())
    const wrapper = await mountPanel()

    await wrapper.find("#ai-context").setValue("Standup every Monday at 9:30")
    await findButton(wrapper, "Generate Event")!.trigger("click")
    await flushPromises()

    expect(wrapper.text()).toContain("2 events generated")
    expect(wrapper.text()).toContain("Team standup")
    expect(wrapper.text()).toContain("Repeats weekly · 5 times")
    expect(wrapper.text()).toContain("10 minutes before")
    expect(wrapper.text()).toContain("For Alice")
    expect(wrapper.text()).toContain("Zoom")
    expect(wrapper.text()).toContain("Check the date")
    expect(wrapper.text()).toContain("All day")

    await wrapper.findAll(".ai-item-edit")[0]!.trigger("click")
    expect((wrapper.find(".ai-edit-title").element as HTMLInputElement).value).toBe("Team standup")
    await wrapper.findAll(".ai-item-edit")[0]!.trigger("click")
    expect(wrapper.find(".ai-item-editor").exists()).toBe(false)

    const add = findButton(wrapper, "Add 2 events")!
    await add.trigger("click")
    await flushPromises()

    expect(wrapper.emitted("done")).toBeUndefined()
    expect(wrapper.text()).toContain("Added 2 events to your calendar.")
    expect(wrapper.text()).toContain("Recently added")
    expect(wrapper.findAll(".ai-added-item")).toHaveLength(2)
    expect(findButton(wrapper, "Done")).toBeTruthy()
    expect(findButton(wrapper, "Add another")).toBeTruthy()

    const posts = fetchMock.mock.calls.filter(
      call => String(call[0]).endsWith("/events") && (call[1] as RequestInit)?.method === "POST",
    )
    expect(posts).toHaveLength(2)
    expect(JSON.parse((posts[0]![1] as RequestInit).body as string)).toMatchObject({
      calendar_id: "cal-1",
      title: "Team standup",
      reminder_minutes: 10,
      source_message: "Standup every Monday at 9:30",
    })

    await findButton(wrapper, "Done")!.trigger("click")
    expect(wrapper.emitted("done")).toEqual([[2]])
  })

  it("selects none/all and starts over", async () => {
    install(handlerWith())
    const wrapper = await mountPanel()
    await wrapper.find("#ai-context").setValue("Standup")
    await findButton(wrapper, "Generate Event")!.trigger("click")
    await flushPromises()

    await findButton(wrapper, "Select none")!.trigger("click")
    expect(findButton(wrapper, "Add 0 events")!.attributes("disabled")).toBeDefined()
    await wrapper.find('input[type="checkbox"]').trigger("change")
    expect(findButton(wrapper, "Add 1 event")).toBeTruthy()
    await findButton(wrapper, "Select all")!.trigger("click")
    expect(findButton(wrapper, "Add 2 events")).toBeTruthy()

    await findButton(wrapper, "Change message")!.trigger("click")
    expect((wrapper.find("#ai-context").element as HTMLTextAreaElement).value).toBe("Standup")
    expect(wrapper.text()).not.toContain("2 events generated")
  })

  it("reports parse failures and empty results", async () => {
    install((url, init) => {
      if (url.includes("/ai/parse/stream")) return json({ detail: "OpenCode is down" }, 500)
      if (url.includes("/ai")) return json(STATUS_ON)
      return json({})
    })
    const wrapper = await mountPanel()
    await wrapper.find("#ai-context").setValue("Standup")
    await findButton(wrapper, "Generate Event")!.trigger("click")
    await flushPromises()
    expect(wrapper.find('[role="alert"]').text()).toContain("OpenCode is down")

    install(handlerWith([], 2))
    const empty = await mountPanel()
    await empty.find("#ai-context").setValue("Newsletter")
    await findButton(empty, "Generate Event")!.trigger("click")
    await flushPromises()
    expect(empty.text()).toContain("No events generated")
    expect(empty.text()).toContain("2 entries couldn't be turned into an event")
    expect(empty.find(".ai-empty").exists()).toBe(true)
    expect(empty.find(".ai-source").exists()).toBe(true)
  })

  it("renders date fallbacks and unknown repeat rules", async () => {
    install(
      handlerWith([
        {
          title: "Broken",
          description: "",
          start_at: "not-a-date",
          end_at: null,
          all_day: false,
          recurrence: { freq: "hourly" },
          reminder_minutes: null,
          assignee_id: null,
          confidence: 0.2,
        },
        {
          title: "No repeat",
          description: "",
          start_at: "2026-03-01T10:00:00Z",
          end_at: null,
          all_day: false,
          recurrence: null,
          reminder_minutes: null,
          assignee_id: null,
          confidence: 0.9,
        },
        {
          title: "Bad until",
          description: "",
          start_at: "2026-03-01T10:00:00Z",
          end_at: null,
          all_day: false,
          recurrence: { freq: "monthly", until: "nope" },
          reminder_minutes: null,
          assignee_id: null,
          confidence: 0.9,
        },
      ]),
    )
    const wrapper = await mountPanel()
    await wrapper.find("#ai-context").setValue("Dates")
    await findButton(wrapper, "Generate Event")!.trigger("click")
    await flushPromises()
    expect(wrapper.text()).toContain("Date unknown")
    expect(wrapper.text()).toContain("Repeats hourly")
    expect(wrapper.text()).toContain("Repeats monthly")
    expect(wrapper.text()).not.toContain("No dated events")

    await wrapper.findAll(".ai-item-edit")[0]!.trigger("click")
    expect((wrapper.find(".ai-edit-title").element as HTMLInputElement).value).toBe("Broken")
    await wrapper.findAll(".ai-item-edit")[0]!.trigger("click")
    expect(wrapper.find(".ai-item-editor").exists()).toBe(false)
  })

  it("reports when none of the drafts can be saved", async () => {
    install((url, init) => {
      const method = init?.method ?? "GET"
      if (url.includes("/ai/parse/stream")) return streamed(DRAFTS)
      if (url.includes("/ai/parse")) return json({ events: DRAFTS, skipped: 0, model: "m" })
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
    await wrapper.find("#ai-context").setValue("Standup")
    await findButton(wrapper, "Generate Event")!.trigger("click")
    await flushPromises()
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
      if (url.includes("/ai/parse/stream")) return streamed(DRAFTS)
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
    await wrapper.find("#ai-context").setValue("Standup")
    await findButton(wrapper, "Generate Event")!.trigger("click")
    await flushPromises()
    await findButton(wrapper, "Add 2 events")!.trigger("click")
    await flushPromises()

    expect(wrapper.text()).toContain("Added 1 event. 1 couldn't be saved.")
    expect(wrapper.findAll(".ai-added-item")).toHaveLength(1)
    expect(findButton(wrapper, "Add 1 event")).toBeTruthy()
    expect(findButton(wrapper, "Done")).toBeUndefined()
  })

  it("shows extraction warnings", async () => {
    install((url) => {
      if (url.includes("/ai/parse/stream")) {
        return streamed(DRAFTS, 0, "Reading", [
          "The message may list 30 dated items, but only 2 were found. Check for missing events.",
        ])
      }
      if (url.includes("/ai")) return json(STATUS_ON)
      return json({})
    })
    const wrapper = await mountPanel()
    await wrapper.find("#ai-context").setValue("Lunch schedule")
    await findButton(wrapper, "Generate Event")!.trigger("click")
    await flushPromises()
    expect(wrapper.find(".ai-warnings").text()).toContain("only 2 were found")
  })

  it("attaches images from the file picker, drag-and-drop and paste", async () => {
    install(handlerWith())
    const wrapper = await mountPanel()

    await findButton(wrapper, "Browse")!.trigger("click")

    const input = wrapper.find('input[type="file"]')
    const file = new File([new Uint8Array([1, 2, 3])], "shot.png", { type: "image/png" })
    Object.defineProperty(input.element, "files", { value: [file], configurable: true })
    await input.trigger("change")
    await vi.waitFor(() => expect(wrapper.text()).toContain("shot.png"))
    await findButton(wrapper, "Browse")?.trigger("click")
    await wrapper.find(".ai-drop").trigger("dragover")
    await wrapper.find(".ai-drop").trigger("dragleave")
    await wrapper.find(".ai-clear").trigger("click")
    expect(wrapper.text()).not.toContain("shot.png")

    await wrapper.find(".ai-drop").trigger("drop", { dataTransfer: { files: [file] } })
    await vi.waitFor(() => expect(wrapper.text()).toContain("shot.png"))
    await wrapper.find(".ai-clear").trigger("click")

    const imageFile = new File([new Uint8Array([4])], "paste.png", { type: "image/png" })
    await wrapper.find(".ai-import").trigger("paste", { clipboardData: { files: [imageFile] } })
    await vi.waitFor(() => expect(wrapper.text()).toContain("paste.png"))

    await wrapper.find("#ai-context").setValue("Dinner Friday")
    await findButton(wrapper, "Generate Event")!.trigger("click")
    await flushPromises()
    const parseCall = fetchMock.mock.calls.find(call => String(call[0]).includes("/ai/parse"))
    const body = JSON.parse((parseCall![1] as RequestInit).body as string)
    expect(body.image).toContain("data:image/png;base64,")

    await findButton(wrapper, "Add 2 events")!.trigger("click")
    await flushPromises()
    const posts = fetchMock.mock.calls.filter(
      call => String(call[0]).endsWith("/events") && (call[1] as RequestInit)?.method === "POST",
    )
    const source = JSON.parse((posts[0]![1] as RequestInit).body as string).source_message
    expect(source).toContain("Dinner Friday")
    expect(source).toContain("[Image: paste.png]")
  })

  it("ignores unusable files and drops", async () => {
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

    await wrapper.find(".ai-drop").trigger("drop", { dataTransfer: { files: [] } })
    await wrapper.find(".ai-import").trigger("paste", { clipboardData: { files: [] } })
    expect(wrapper.find(".ai-thumb").exists()).toBe(false)
  })

  it("requires a message and treats the image as optional", async () => {
    install(handlerWith())
    const wrapper = await mountPanel()
    expect(wrapper.text()).toContain("Message with event details")
    expect(wrapper.text()).toContain("Upload image (optional)")
    expect(wrapper.find("#ai-context").attributes("required")).toBeDefined()

    const input = wrapper.find('input[type="file"]')
    const file = new File([new Uint8Array([1, 2, 3])], "agenda.png", { type: "image/png" })
    Object.defineProperty(input.element, "files", { value: [file], configurable: true })
    await input.trigger("change")
    await vi.waitFor(() => expect(wrapper.text()).toContain("agenda.png"))

    expect(findButton(wrapper, "Generate Event")!.attributes("disabled")).toBeDefined()
    await wrapper.find("#ai-context").setValue("Dinner Friday at 7pm")
    expect(findButton(wrapper, "Generate Event")!.attributes("disabled")).toBeUndefined()
  })

  it("shows progress while the model streams, without putting JSON in the way", async () => {
    const stream = progressiveStream()
    install(url => {
      if (url.includes("/ai/parse/stream")) return stream.response
      if (url.includes("/ai")) return json(STATUS_ON)
      return json({})
    })
    const wrapper = await mountPanel()
    await wrapper.find("#ai-context").setValue("Standup")
    await findButton(wrapper, "Generate Event")!.trigger("click")
    await flushPromises()

    expect(wrapper.text()).toContain("Generating event details…")
    expect(wrapper.text()).toContain("Model activity")
    expect(wrapper.text()).toContain("Reading the message and checking each date.")
    expect(wrapper.text()).not.toContain("2 events generated")

    stream.finish()
    await flushPromises()
    expect(wrapper.text()).toContain("2 events generated")
  })

  it("edits a draft before adding it", async () => {
    install(handlerWith())
    const wrapper = await mountPanel()
    await wrapper.find("#ai-context").setValue("Standup")
    await findButton(wrapper, "Generate Event")!.trigger("click")
    await flushPromises()

    expect(wrapper.find(".ai-item--low").exists()).toBe(true)
    await wrapper.findAll(".ai-item-edit")[1]!.trigger("click")
    expect(wrapper.find(".ai-added-item").exists()).toBe(false)

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
    const posts = fetchMock.mock.calls.filter(
      call => String(call[0]).endsWith("/events") && (call[1] as RequestInit)?.method === "POST",
    )
    const edited = posts
      .map(call => JSON.parse((call[1] as RequestInit).body as string))
      .find(body => body.title === "Holiday (school closed)")
    expect(edited.start_at).toBe(new Date("2026-05-06T09:15").toISOString())
    expect(edited.end_at).toBe(new Date("2026-05-06T10:15").toISOString())
    expect(edited.all_day).toBe(false)
  })

  it("validates the inline editor and keeps all-day ranges", async () => {
    install(handlerWith())
    const wrapper = await mountPanel()
    await wrapper.find("#ai-context").setValue("Standup")
    await findButton(wrapper, "Generate Event")!.trigger("click")
    await flushPromises()

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
    expect(wrapper.findAll('.ai-item--editing input[type="time"]')).toHaveLength(0)
    dates = wrapper.findAll('.ai-item--editing input[type="date"]')
    await dates[1]!.setValue("2026-05-08")
    await findButton(wrapper, "Save changes")!.trigger("click")
    await flushPromises()

    expect(wrapper.find(".ai-item--low").exists()).toBe(false)
    expect(wrapper.text()).toContain("All day")

    await findButton(wrapper, "Add 2 events")!.trigger("click")
    await flushPromises()
    const posts = fetchMock.mock.calls.filter(
      call => String(call[0]).endsWith("/events") && (call[1] as RequestInit)?.method === "POST",
    )
    const edited = posts
      .map(call => JSON.parse((call[1] as RequestInit).body as string))
      .find(body => body.title === "Holiday")
    expect(edited.all_day).toBe(true)
    expect(new Date(edited.end_at).toISOString()).toBe(new Date("2026-05-08T23:59:59").toISOString())
  })

  it("offers a manual fallback and keeps the source editable", async () => {
    install(handlerWith([], 2))
    const wrapper = await mountPanel()
    await wrapper.find("#ai-context").setValue("Newsletter")
    await findButton(wrapper, "Generate Event")!.trigger("click")
    await flushPromises()

    expect(wrapper.find(".ai-empty").exists()).toBe(true)
    await findButton(wrapper, "Add manually")!.trigger("click")
    expect(wrapper.emitted("manual")).toHaveLength(1)

    await findButton(wrapper, "Change message")!.trigger("click")
    expect((wrapper.find("#ai-context").element as HTMLTextAreaElement).value).toBe("Newsletter")
  })

  it("starts another import from the success screen", async () => {
    install(handlerWith())
    const wrapper = await mountPanel()
    await wrapper.find("#ai-context").setValue("Standup")
    await findButton(wrapper, "Generate Event")!.trigger("click")
    await flushPromises()
    await findButton(wrapper, "Add 2 events")!.trigger("click")
    await flushPromises()

    expect(wrapper.text()).toContain("Added 2 events")
    await findButton(wrapper, "Add another")!.trigger("click")
    expect((wrapper.find("#ai-context").element as HTMLTextAreaElement).value).toBe("")
    expect(wrapper.text()).not.toContain("Added 2 events")
  })

  it("shows the original message and multi-day drafts", async () => {
    const longDescription = "Bring the signed form, a packed lunch, water and comfortable shoes for the walk. ".repeat(3)
    install(handlerWith([
      {
        title: "Conference",
        description: longDescription,
        start_at: "2026-05-01T09:00:00-04:00",
        end_at: "2026-05-03T17:00:00-04:00",
        all_day: false,
        recurrence: null,
        reminder_minutes: null,
        assignee_id: null,
        confidence: 0.9,
      },
      {
        title: "School break",
        description: "",
        start_at: "2026-05-04T00:00:00-04:00",
        end_at: "2026-05-06T00:00:00-04:00",
        all_day: true,
        recurrence: null,
        reminder_minutes: null,
        assignee_id: null,
        confidence: 0.9,
      },
    ]))
    const wrapper = await mountPanel()
    await wrapper.find("#ai-context").setValue("Conference details")
    await findButton(wrapper, "Generate Event")!.trigger("click")
    await flushPromises()

    expect(wrapper.find(".ai-source-preview").text()).toContain("Conference details")
    expect(wrapper.find(".ai-source-text").text()).toContain("Conference details")
    expect(wrapper.find(".ai-item-when").text()).toContain("–")
    expect(wrapper.text()).toContain("All day")
    expect(wrapper.find(".ai-item-desc").text().endsWith("…")).toBe(true)
  })
})
