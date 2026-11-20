import { beforeEach, describe, expect, it, vi } from "vitest"
import { flushPromises, mount } from "@vue/test-utils"
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
    assignee_id: null,
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

function streamed(drafts: unknown[] = DRAFTS, skipped = 0, reasoning = "Reading the message") {
  const response = JSON.stringify({ events: drafts })
  const body = [
    `event: reasoning\ndata: ${JSON.stringify({ type: "reasoning", text: reasoning })}\n\n`,
    `event: content\ndata: ${JSON.stringify({ type: "content", text: response })}\n\n`,
    `event: result\ndata: ${JSON.stringify({
      type: "result", events: drafts, skipped, model: "deepseek-v4.1-flash",
      response, reasoning,
    })}\n\n`,
  ].join("")
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  })
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

async function mountPanel() {
  const wrapper = mount(AiImportPanel)
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

  it("shows an error when the settings check fails", async () => {
    install(url => {
      if (url.includes("/ai")) throw new TypeError("offline")
      return json({})
    })
    const wrapper = await mountPanel()
    expect(wrapper.find('[role="alert"]').text()).toContain("Could not check Smart import settings")
  })

  it("parses text, previews drafts and creates the selected events", async () => {
    install(handlerWith())
    const wrapper = await mountPanel()

    await wrapper.find("#ai-context").setValue("Standup every Monday at 9:30")
    await findButton(wrapper, "Find events")!.trigger("click")
    await flushPromises()

    expect(wrapper.text()).toContain("2 events found")
    expect(wrapper.text()).toContain("Team standup")
    expect(wrapper.text()).toContain("Repeats weekly (5×)")
    expect(wrapper.text()).toContain("Check the details")
    expect(wrapper.text()).toContain("Model response")
    expect(wrapper.text()).toContain("Reading the message")
    expect(wrapper.text()).toContain("Output")

    const add = findButton(wrapper, "Add 2 events")!
    await add.trigger("click")
    await flushPromises()

    expect(wrapper.emitted("done")).toBeUndefined()
    expect(wrapper.text()).toContain("Added 2 events to your calendar.")
    expect(wrapper.text()).toContain("Recently added")
    expect(wrapper.findAll(".ai-added-item")).toHaveLength(2)
    expect(findButton(wrapper, "Done")).toBeTruthy()

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
    await findButton(wrapper, "Find events")!.trigger("click")
    await flushPromises()

    await findButton(wrapper, "Select none")!.trigger("click")
    expect(findButton(wrapper, "Add 0 events")!.attributes("disabled")).toBeDefined()
    await wrapper.find('input[type="checkbox"]').trigger("change")
    expect(findButton(wrapper, "Add 1 event")).toBeTruthy()
    await findButton(wrapper, "Select all")!.trigger("click")
    expect(findButton(wrapper, "Add 2 events")).toBeTruthy()

    await findButton(wrapper, "Clear")!.trigger("click")
    expect((wrapper.find("#ai-context").element as HTMLTextAreaElement).value).toBe("")
    expect(wrapper.text()).not.toContain("2 events found")
  })

  it("reports parse failures and empty results", async () => {
    install((url, init) => {
      if (url.includes("/ai/parse/stream")) return json({ detail: "OpenCode is down" }, 500)
      if (url.includes("/ai")) return json(STATUS_ON)
      return json({})
    })
    const wrapper = await mountPanel()
    await wrapper.find("#ai-context").setValue("Standup")
    await findButton(wrapper, "Find events")!.trigger("click")
    await flushPromises()
    expect(wrapper.find('[role="alert"]').text()).toContain("OpenCode is down")

    install(handlerWith([], 2))
    const empty = await mountPanel()
    await empty.find("#ai-context").setValue("Newsletter")
    await findButton(empty, "Find events")!.trigger("click")
    await flushPromises()
    expect(empty.text()).toContain("No events found")
    expect(empty.text()).toContain("2 items had no date")
    expect(empty.find(".ai-empty").exists()).toBe(true)
    expect(empty.find(".ai-stream").exists()).toBe(true)
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
    await findButton(wrapper, "Find events")!.trigger("click")
    await flushPromises()
    expect(wrapper.text()).toContain("Date unknown")
    expect(wrapper.text()).toContain("Repeats hourly")
    expect(wrapper.text()).toContain("Repeats monthly")
    expect(wrapper.text()).not.toContain("No dated events")
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
    await findButton(wrapper, "Find events")!.trigger("click")
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
    await findButton(wrapper, "Find events")!.trigger("click")
    await flushPromises()
    await findButton(wrapper, "Add 2 events")!.trigger("click")
    await flushPromises()

    expect(wrapper.text()).toContain("Some events were added. 1 could not be saved.")
    expect(wrapper.findAll(".ai-added-item")).toHaveLength(1)
    expect(findButton(wrapper, "Add 1 event")).toBeTruthy()
    expect(findButton(wrapper, "Done")).toBeTruthy()
  })

  it("attaches images from the file picker, drag-and-drop and paste", async () => {
    install(handlerWith())
    const wrapper = await mountPanel()

    await findButton(wrapper, "Choose")!.trigger("click")

    const input = wrapper.find('input[type="file"]')
    const file = new File([new Uint8Array([1, 2, 3])], "shot.png", { type: "image/png" })
    Object.defineProperty(input.element, "files", { value: [file], configurable: true })
    await input.trigger("change")
    await vi.waitFor(() => expect(wrapper.text()).toContain("shot.png"))
    await findButton(wrapper, "Choose")?.trigger("click")
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
    await findButton(wrapper, "Find events")!.trigger("click")
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
    expect(source).toContain("[Screenshot: paste.png]")
  })

  it("ignores unusable files and drops", async () => {
    install(handlerWith())
    const wrapper = await mountPanel()
    const input = wrapper.find('input[type="file"]')

    const text = new File(["hello"], "notes.txt", { type: "text/plain" })
    Object.defineProperty(input.element, "files", { value: [text], configurable: true })
    await input.trigger("change")
    expect(wrapper.text()).toContain("Attach a PNG, JPEG, WebP or GIF image")

    const huge = new File([new Uint8Array(9 * 1024 * 1024)], "huge.png", { type: "image/png" })
    Object.defineProperty(input.element, "files", { value: [huge], configurable: true })
    await input.trigger("change")
    expect(wrapper.text()).toContain("larger than 8 MB")

    await wrapper.find(".ai-drop").trigger("drop", { dataTransfer: { files: [] } })
    await wrapper.find(".ai-import").trigger("paste", { clipboardData: { files: [] } })
    expect(wrapper.find(".ai-thumb").exists()).toBe(false)
  })
})
