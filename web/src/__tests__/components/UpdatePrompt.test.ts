import { describe, expect, it, vi } from "vitest"
import { flushPromises, mount } from "@vue/test-utils"
import UpdatePrompt from "@/components/shared/UpdatePrompt.vue"
import { useUpdatePrompt } from "@/composables/useUpdatePrompt"

const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  })

function status(overrides: Record<string, unknown> = {}) {
  return {
    current: { version: "0.2.0", commit: "", image: null, tag: null, digest: null, channel: "stable" },
    latest: {
      version: "0.3.0",
      tag: "0.3.0",
      name: "0.3.0",
      published_at: "2026-10-01T00:00:00Z",
      html_url: "https://example.com/v0.3.0",
      notes: "",
      current: false,
      latest: true,
      previous: false,
      held: false,
      major: false,
      newer: true,
    },
    update_available: true,
    releases: [],
    previous: { version: null, image: null },
    held: { version: null, reason: null },
    job: null,
    auto: { enabled: true, checkIntervalMinutes: 5 },
    update_prompt: { version: "0.3.0", dismissed: false },
    self_update: { available: true, managed: true, reason: null, mode: "managed" },
    manual: { current: "", stable: "" },
    checked_at: "2026-10-19T12:00:00Z",
    stale: false,
    error: null,
    ...overrides,
  }
}

const global = { stubs: { teleport: true } }

describe("UpdatePrompt", () => {
  it("offers an available update with yes/no actions", async () => {
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce(json(status()))

    const wrapper = mount(UpdatePrompt, { global })
    await flushPromises()

    expect(wrapper.text()).toContain("New version available")
    expect(wrapper.text()).toContain("HOMST 0.3.0")
    expect(wrapper.text()).toContain("No, not now")
    expect(wrapper.text()).toContain("Yes, install")
    wrapper.unmount()
  })

  it("shows the major-version warning", async () => {
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce(json(status({
      latest: { ...status().latest, version: "1.0.0", major: true },
      update_prompt: { version: "1.0.0", dismissed: false },
    })))

    const wrapper = mount(UpdatePrompt, { global })
    await flushPromises()

    expect(wrapper.text()).toContain("major update")
    wrapper.unmount()
  })

  it("does not prompt when the release was dismissed", async () => {
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce(json(status({
      update_prompt: { version: null, dismissed: true },
    })))

    const wrapper = mount(UpdatePrompt, { global })
    await flushPromises()

    expect(wrapper.find(".update-prompt").exists()).toBe(false)
    wrapper.unmount()
  })

  it("declines the update through the API and hides the prompt", async () => {
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce(json(status()))
    fetchMock.mockResolvedValueOnce(json({ dismissed: "0.3.0" }))

    const wrapper = mount(UpdatePrompt, { global })
    await flushPromises()

    await wrapper.findAll("button").find((button) => button.text() === "No, not now")!.trigger("click")
    await flushPromises()

    const call = fetchMock.mock.calls.find((item) => String(item[0]).includes("/system/prompt/dismiss"))
    expect(call).toBeTruthy()
    expect((call![1] as RequestInit).headers).toMatchObject({ "X-HOMST-Update": "1" })
    expect(JSON.parse((call![1] as RequestInit).body as string)).toEqual({ version: "0.3.0" })
    expect(useUpdatePrompt().prompt.value).toBeNull()
    wrapper.unmount()
  })

  it("shows the install started from another display", async () => {
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce(json(status({
      update_prompt: { version: null, dismissed: false },
      job: {
        id: "job-1",
        state: "pulling",
        version: "0.3.0",
        latest: true,
        message: "Downloading",
        progress: { percent: 10, bytes: 10, total: 100 },
        error: null,
        from_version: "0.2.0",
        to_version: "0.3.0",
        started_at: "2026-10-19T12:00:00Z",
        finished_at: null,
      },
    })))

    const wrapper = mount(UpdatePrompt, { global })
    await flushPromises()

    expect(wrapper.text()).toContain("Installing HOMST 0.3.0")
    expect(wrapper.text()).not.toContain("Yes, install")
    wrapper.unmount()
  })

  it("starts the install when accepted", async () => {
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce(json(status()))
    fetchMock.mockResolvedValueOnce(json({
      id: "job-1",
      state: "queued",
      version: "0.3.0",
      latest: true,
      message: "Queued",
      progress: { percent: 0, bytes: 0, total: 0 },
      error: null,
      from_version: "0.2.0",
      to_version: "0.3.0",
      started_at: "2026-10-19T12:00:00Z",
      finished_at: null,
    }))

    const wrapper = mount(UpdatePrompt, { global })
    await flushPromises()

    await wrapper.findAll("button").find((button) => button.text() === "Yes, install")!.trigger("click")
    await flushPromises()

    const call = fetchMock.mock.calls.find((item) => String(item[0]).includes("/system/install"))
    expect(call).toBeTruthy()
    expect(JSON.parse((call![1] as RequestInit).body as string)).toEqual({
      version: "0.3.0",
      retry: false,
    })
    expect(wrapper.text()).toContain("Installing HOMST 0.3.0")
    wrapper.unmount()
  })
})
