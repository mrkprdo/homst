import { describe, expect, it, vi } from "vitest"
import { flushPromises, mount } from "@vue/test-utils"
import SoftwareUpdateCard from "@/components/settings/SoftwareUpdateCard.vue"

const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  })

function status(overrides: Record<string, unknown> = {}) {
  return {
    current: {
      version: "0.2.0",
      commit: "81cef74",
      image: "ghcr.io/mrkprdo/homst:latest",
      tag: "latest",
      digest: null,
      channel: "stable",
    },
    latest: {
      version: "0.3.0",
      tag: "0.3.0",
      name: "0.3.0",
      published_at: "2026-10-01T00:00:00Z",
      html_url: "https://example.com/v0.3.0",
      notes: "Notes",
      current: false,
      latest: true,
      previous: false,
      held: false,
      major: false,
      newer: true,
    },
    update_available: true,
    releases: [
      {
        version: "0.3.0",
        tag: "0.3.0",
        name: "0.3.0",
        published_at: "2026-10-01T00:00:00Z",
        html_url: "https://example.com/v0.3.0",
        notes: "Notes",
        current: false,
        latest: true,
        previous: false,
        held: false,
        major: false,
        newer: true,
      },
      {
        version: "0.2.0",
        tag: "0.2.0",
        name: "0.2.0",
        published_at: "2026-09-01T00:00:00Z",
        html_url: "https://example.com/v0.2.0",
        notes: "",
        current: true,
        latest: false,
        previous: false,
        held: false,
        major: false,
        newer: false,
      },
    ],
    previous: { version: null, image: null },
    held: { version: null, reason: null },
    job: null,
    auto: { enabled: true, checkIntervalMinutes: 5 },
    update_prompt: { version: "0.3.0", dismissed: false },
    self_update: { available: true, managed: true, reason: null, mode: "managed" },
    manual: {
      current: "docker compose -f docker-compose.prod.yml pull && docker compose -f docker-compose.prod.yml up -d",
      stable: "HOMST_VERSION=latest docker compose pull",
    },
    checked_at: "2026-10-19T12:00:00Z",
    stale: false,
    error: null,
    ...overrides,
  }
}

describe("SoftwareUpdateCard", () => {
  it("shows an available stable update and asks for confirmation", async () => {
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce(json(status()))

    const wrapper = mount(SoftwareUpdateCard)
    await flushPromises()

    expect(wrapper.text()).toContain("HOMST 0.2.0")
    expect(wrapper.text()).toContain("HOMST 0.3.0 is available")
    const update = wrapper.findAll("button").find((button) => button.text() === "Update")
    expect(update).toBeTruthy()

    await update!.trigger("click")
    expect(wrapper.text()).toContain("Install HOMST 0.3.0?")
    wrapper.unmount()
  })

  it("posts to the system install endpoint with the confirmation header", async () => {
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

    const wrapper = mount(SoftwareUpdateCard)
    await flushPromises()
    await wrapper.findAll("button").find((button) => button.text() === "Update")!.trigger("click")
    await flushPromises()
    const install = wrapper.findAll("button").find((button) => button.text() === "Install")
    expect(install).toBeTruthy()
    await install!.trigger("click")
    await flushPromises()

    const call = fetchMock.mock.calls.find((item) => String(item[0]).includes("/system/install"))
    expect(call).toBeTruthy()
    expect((call![1] as RequestInit).headers).toMatchObject({ "X-HOMST-Update": "1" })
    expect(JSON.parse((call![1] as RequestInit).body as string)).toEqual({
      version: "0.3.0",
      retry: false,
    })
    wrapper.unmount()
  })

  it("saves the update-check interval", async () => {
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce(json(status()))
    fetchMock.mockResolvedValueOnce(json({ message: "ok" }))

    const wrapper = mount(SoftwareUpdateCard)
    await flushPromises()

    const select = wrapper.find("select")
    expect((select.element as HTMLSelectElement).value).toBe("5")
    await select.setValue("15")
    await flushPromises()

    const patch = fetchMock.mock.calls.find((item) => (item[1] as RequestInit)?.method === "PATCH")
    expect(patch).toBeTruthy()
    expect(JSON.parse((patch![1] as RequestInit).body as string)).toEqual({
      settings: { updates: { enabled: true, checkIntervalMinutes: 15 } },
    })
    wrapper.unmount()
  })

  it("refreshes when another display changes the update state", async () => {
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce(json(status()))

    const wrapper = mount(SoftwareUpdateCard)
    await flushPromises()
    expect(wrapper.text()).toContain("HOMST 0.3.0 is available")

    fetchMock.mockResolvedValueOnce(json(status({
      update_available: false,
      latest: null,
      update_prompt: { version: null, dismissed: false },
    })))
    window.dispatchEvent(new CustomEvent("homst:update-changed"))
    await flushPromises()

    expect(wrapper.text()).not.toContain("HOMST 0.3.0 is available")
    expect(fetchMock).toHaveBeenCalledTimes(2)
    wrapper.unmount()
  })

  it("shows manual instructions for nightly builds", async () => {
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce(json(status({
      current: {
        version: "dev",
        commit: "",
        image: "ghcr.io/mrkprdo/homst:dev",
        tag: "dev",
        digest: null,
        channel: "nightly",
      },
      update_available: false,
      self_update: {
        available: true,
        managed: false,
        reason: "Nightly builds are updated manually.",
        mode: "manual",
      },
      manual: {
        current: "HOMST_VERSION=dev docker compose -f docker-compose.prod.yml pull",
        stable: "HOMST_VERSION=latest docker compose -f docker-compose.prod.yml pull",
      },
    })))

    const wrapper = mount(SoftwareUpdateCard)
    await flushPromises()

    expect(wrapper.text()).toContain("Nightly build")
    expect(wrapper.text()).toContain("HOMST_VERSION=dev")
    expect(wrapper.findAll("button").some((button) => button.text() === "Update")).toBe(false)
    wrapper.unmount()
  })
})
