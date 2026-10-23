import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { mount, flushPromises } from "@vue/test-utils"
import type { SystemJob, SystemStatus } from "@/api/system"

vi.mock("@/api/system", () => ({
  systemApi: {
    getStatus: vi.fn(),
    getJob: vi.fn(),
    install: vi.fn(),
    dismissPrompt: vi.fn(),
    retryRollback: vi.fn(),
  },
}))

vi.mock("@/api/household", () => ({
  householdApi: {
    updateSettings: vi.fn(),
  },
}))

import { systemApi } from "@/api/system"
import { householdApi } from "@/api/household"
import SoftwareUpdateCard from "@/components/settings/SoftwareUpdateCard.vue"

function release(version: string, overrides: Record<string, unknown> = {}) {
  return {
    version,
    tag: version,
    name: version,
    published_at: "2026-10-01T00:00:00Z",
    html_url: `https://example.com/${version}`,
    notes: "",
    current: false,
    latest: false,
    previous: false,
    held: false,
    major: false,
    newer: true,
    ...overrides,
  }
}

function job(overrides: Record<string, unknown> = {}): SystemJob {
  return {
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
    ...overrides,
  } as SystemJob
}

function status(overrides: Record<string, unknown> = {}): SystemStatus {
  return {
    current: {
      version: "0.2.0", commit: "81cef74", image: "ghcr.io/mrkprdo/homst:latest",
      tag: "latest", digest: null, channel: "stable",
    },
    latest: release("0.3.0", { latest: true }),
    update_available: true,
    releases: [
      release("0.3.0", { latest: true }),
      release("0.2.0", { current: true, newer: false }),
    ],
    previous: { version: null, image: null },
    held: { version: null, reason: null },
    job: null,
    auto: { enabled: true, checkIntervalMinutes: 5 },
    update_prompt: { version: "0.3.0", dismissed: false },
    self_update: { available: true, managed: true, reason: null, mode: "managed" },
    manual: { current: "docker compose pull", stable: "docker compose pull" },
    checked_at: "2026-10-19T12:00:00Z",
    stale: false,
    error: null,
    ...overrides,
  } as unknown as SystemStatus
}

const getStatus = vi.mocked(systemApi.getStatus)
const getJob = vi.mocked(systemApi.getJob)
const install = vi.mocked(systemApi.install)
const updateSettings = vi.mocked(householdApi.updateSettings)

beforeEach(() => {
  vi.useFakeTimers()
  getStatus.mockReset().mockResolvedValue(status())
  getJob.mockReset()
  install.mockReset().mockResolvedValue(job())
  updateSettings.mockReset().mockResolvedValue({} as never)
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  localStorage.clear()
})

async function mountCard() {
  const wrapper = mount(SoftwareUpdateCard)
  await flushPromises()
  return wrapper
}

describe("SoftwareUpdateCard residual", () => {
  it("includes a held release in the history beyond the first six", async () => {
    const releases = Array.from({ length: 8 }, (_, index) =>
      release(`0.${8 - index}.0`, {
        held: index === 7,
        newer: index !== 7,
      }),
    )
    getStatus.mockResolvedValueOnce(status({
      releases,
      held: { version: "0.1.0", reason: "failed" },
      update_available: false,
      latest: null,
    }))
    const wrapper = await mountCard()
    expect(wrapper.text()).toContain("HOMST 0.1.0")
    expect(wrapper.text()).toContain("Held")
  })

  it("renders progress, channel labels, and badges", async () => {
    getStatus.mockResolvedValueOnce(status({
      current: { ...status().current, channel: "pinned" },
      update_available: false,
      latest: null,
      self_update: { available: true, managed: true, reason: null, mode: "managed" },
      releases: [
        release("0.2.0", { previous: true, newer: false }),
        release("0.1.0", { newer: false }),
      ],
      job: job({
        state: "pulling",
        progress: { percent: 150, bytes: 1, total: 1 },
      }),
    }))
    const wrapper = await mountCard()
    expect(wrapper.find(".job-percent").text()).toBe("100%")
    expect(wrapper.text()).toContain("Previous")
    expect(wrapper.text()).toContain("Older")

    getStatus.mockResolvedValueOnce(status({
      current: { ...status().current, channel: "stable" },
      update_available: false,
      latest: null,
      self_update: { available: true, managed: false, reason: null, mode: "manual" },
    }))
    const manual = await mountCard()
    expect(manual.text()).toContain("Manual updates")

    getStatus.mockResolvedValueOnce(status({
      current: { ...status().current, channel: "pinned" },
      update_available: false,
      latest: null,
      self_update: { available: true, managed: false, reason: "pinned", mode: "manual" },
    }))
    const pinned = await mountCard()
    expect(pinned.text()).toContain("Pinned version")

    getStatus.mockResolvedValueOnce(status({
      current: { ...status().current, channel: "custom" },
      update_available: false,
      latest: null,
      self_update: { available: true, managed: false, reason: "custom", mode: "manual" },
    }))
    const custom = await mountCard()
    expect(custom.text()).toContain("Custom image")
  })

  it("hides a finished job from more than a day ago", async () => {
    getStatus.mockResolvedValueOnce(status({
      update_available: false,
      latest: null,
      job: job({
        state: "success",
        finished_at: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),
      }),
    }))
    const wrapper = await mountCard()
    expect(wrapper.text()).not.toContain("Update complete")
  })

  it("checks again on demand", async () => {
    getStatus
      .mockResolvedValueOnce(status({
        update_available: false,
        latest: null,
        self_update: { available: false, managed: false, reason: null, mode: "manual" },
      }))
      .mockResolvedValueOnce(status({ update_available: false, latest: null }))
    const wrapper = await mountCard()
    await wrapper.findAll("button").find(b => b.text().includes("Check again"))!.trigger("click")
    await flushPromises()
    expect(getStatus).toHaveBeenLastCalledWith(true)
  })

  it("dismisses and retries jobs", async () => {
    getStatus.mockResolvedValueOnce(status({
      update_available: false,
      latest: null,
      job: job({ state: "success", finished_at: new Date().toISOString() }),
    }))
    const wrapper = await mountCard()
    expect(wrapper.text()).toContain("Update complete")
    await wrapper.findAll("button").find(b => b.text() === "Dismiss")!.trigger("click")
    await flushPromises()
    expect(wrapper.text()).not.toContain("Update complete")
  })

  it("reports a non-Error install failure", async () => {
    install.mockRejectedValueOnce("nope")
    const wrapper = await mountCard()
    await wrapper.findAll("button").find(b => b.text() === "Update")!.trigger("click")
    await wrapper.findAll("button").find(b => b.text() === "Install")!.trigger("click")
    await flushPromises()
    expect(wrapper.text()).toContain("Could not start the update.")
  })

  it("offers Retry for a held release and Roll back for an older one", async () => {
    getStatus.mockResolvedValueOnce(status({
      releases: [
        release("0.3.0", { held: true }),
        release("0.1.0", { newer: false }),
        release("0.2.0", { current: true, newer: false }),
      ],
    }))
    const retryWrapper = await mountCard()
    await retryWrapper.findAll("button").find(b => b.text() === "Retry")!.trigger("click")
    await flushPromises()
    expect(install).toHaveBeenCalledWith("0.3.0", true)
    retryWrapper.unmount()

    install.mockClear()
    getStatus.mockResolvedValueOnce(status({
      job: null,
      releases: [
        release("0.3.0", { latest: true }),
        release("0.1.0", { newer: false }),
        release("0.2.0", { current: true, newer: false }),
      ],
    }))
    const wrapper = await mountCard()
    await wrapper.findAll("button").find(b => b.text() === "Roll back")!.trigger("click")
    await flushPromises()
    expect(wrapper.text()).toContain("Roll back to HOMST 0.1.0?")
    const confirm = wrapper.find(".confirm-actions")
    await confirm.findAll("button").find(b => b.text() === "Roll back")!.trigger("click")
    await flushPromises()
    expect(install).toHaveBeenCalledWith("0.1.0", false)
  })

  it("saves automatic-check changes and reports failures", async () => {
    const wrapper = await mountCard()
    const toggle = wrapper.findComponent({ name: "UiToggle" })
    toggle.vm.$emit("update:modelValue", false)
    await flushPromises()
    expect(updateSettings).toHaveBeenCalledWith({
      updates: { enabled: false, checkIntervalMinutes: 5 },
    })

    updateSettings.mockRejectedValueOnce(new Error("nope"))
    toggle.vm.$emit("update:modelValue", true)
    await flushPromises()
    const select = wrapper.find("select")
    updateSettings.mockRejectedValueOnce(new Error("nope"))
    await select.setValue("15")
    await flushPromises()
    expect(wrapper.text()).toContain("Could not save update-check settings.")
  })

  it("copies the manual command and explains a clipboard failure", async () => {
    getStatus.mockResolvedValueOnce(status({
      update_available: false,
      latest: null,
      self_update: { available: false, managed: false, reason: null, mode: "manual" },
      manual: { current: "docker compose pull", stable: "docker compose pull" },
    }))
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    })
    const wrapper = await mountCard()
    await wrapper.findAll("button").find(b => b.text() === "Copy command")!.trigger("click")
    await flushPromises()
    expect(writeText).toHaveBeenCalledWith("docker compose pull")

    writeText.mockRejectedValueOnce(new Error("denied"))
    await wrapper.findAll("button").find(b => b.text() === "Copy command")!.trigger("click")
    await flushPromises()
    expect(writeText).toHaveBeenCalledTimes(2)
  })

  it("polls an install through empty, active, and failed jobs", async () => {
    const wrapper = await mountCard()
    await wrapper.findAll("button").find(b => b.text() === "Update")!.trigger("click")
    await wrapper.findAll("button").find(b => b.text() === "Install")!.trigger("click")
    await flushPromises()

    const vm = wrapper.vm as unknown as { poll: () => Promise<void> }
    getJob.mockResolvedValueOnce({ job: null })
    await vm.poll()
    getJob.mockResolvedValueOnce({ job: job({ state: "pulling" }) })
    await vm.poll()
    const failed = job({ state: "failed", error: "No space" })
    getJob.mockResolvedValueOnce({ job: failed })
    getStatus.mockResolvedValueOnce(status({ update_available: false, latest: null, job: failed }))
    await vm.poll()
    await flushPromises()
    expect(getJob).toHaveBeenCalledTimes(3)
  })

  it("gives up polling after three minutes of restart failures", async () => {
    const wrapper = await mountCard()
    await wrapper.findAll("button").find(b => b.text() === "Update")!.trigger("click")
    await wrapper.findAll("button").find(b => b.text() === "Install")!.trigger("click")
    await flushPromises()

    getJob.mockRejectedValue(new Error("restarting"))
    for (let i = 0; i < 181; i += 1) {
      await vi.advanceTimersByTimeAsync(2000)
    }
    await flushPromises()
    expect(wrapper.text()).toContain("did not come back")
  })
})
