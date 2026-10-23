import { describe, it, expect, vi, afterEach } from "vitest"
import { mount, flushPromises } from "@vue/test-utils"
import AnnouncementBanner from "@/components/shared/AnnouncementBanner.vue"
import AnnouncementLiveList from "@/components/shared/AnnouncementLiveList.vue"
import AnnouncementComposer from "@/components/shared/AnnouncementComposer.vue"
import { announcementsApi } from "@/api/announcements"
import { useAnnouncements } from "@/composables/useAnnouncements"

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })

const API_ANNOUNCEMENT = {
  id: "a1",
  household_id: "h1",
  message: "Dinner is ready",
  created_by: null,
  author_name: "Alice",
  created_at: "2026-06-01T18:00:00Z",
  expires_at: null,
}

function api(overrides: Record<string, unknown> = {}) {
  return { ...API_ANNOUNCEMENT, ...overrides }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe("AnnouncementBanner", () => {
  it("labels invalid timestamps and expiring announcements", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json([
      api({ id: "bad-created", created_at: "not a date" }),
      api({ id: "no-expiry", created_at: "2026-06-01T18:00:00Z" }),
      api({ id: "expires", created_at: "2026-06-01T18:00:00Z", expires_at: new Date(Date.now() + 30 * 60_000).toISOString() }),
    ]))

    const wrapper = mount(AnnouncementBanner, {
      global: { stubs: { teleport: true, PhMegaphone: true, PhX: true } },
    })
    await flushPromises()

    const labels = wrapper.findAll(".announcement-time").map((node) => node.text())
    expect(labels[0]).toBe("Just now")
    expect(labels[1]).toContain("Sent at")
    expect(labels[1]).not.toContain("until")
    expect(labels[2]).toContain("until")
  })

  it("falls back to Sent at for an unusable expiry", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json([
      api({ id: "bad-expiry", created_at: "2026-06-01T18:00:00Z", expires_at: "nope" }),
    ]))
    const wrapper = mount(AnnouncementBanner, {
      global: { stubs: { teleport: true, PhMegaphone: true, PhX: true } },
    })
    await flushPromises()
    const label = wrapper.find(".announcement-time").text()
    expect(label).toContain("Sent at")
    expect(label).not.toContain("until")
  })

  it("dismisses a card from the banner", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json([api()]))
    const wrapper = mount(AnnouncementBanner, {
      global: { stubs: { teleport: true, PhMegaphone: true, PhX: true } },
    })
    await flushPromises()
    await wrapper.find(".announcement-dismiss").trigger("click")
    await flushPromises()
    expect(wrapper.find(".announcement-card").exists()).toBe(false)
  })
})

describe("AnnouncementLiveList", () => {
  it("renders relative and expiry labels for every branch", async () => {
    const now = Date.now()
    vi.mocked(fetch).mockResolvedValueOnce(json([
      api({ id: "invalid", created_at: "nope", expires_at: "nope" }),
      api({
        id: "minutes",
        created_at: new Date(now - 2 * 60_000).toISOString(),
        expires_at: new Date(now + 5 * 60_000).toISOString(),
      }),
      api({
        id: "hours",
        created_at: new Date(now - 3 * 60 * 60_000).toISOString(),
        expires_at: new Date(now + 3 * 60 * 60_000).toISOString(),
      }),
      api({
        id: "days",
        created_at: new Date(now - 3 * 24 * 60 * 60_000).toISOString(),
        expires_at: new Date(now + 3 * 24 * 60 * 60_000).toISOString(),
      }),
      api({
        id: "expired",
        created_at: new Date(now - 60_000).toISOString(),
        expires_at: new Date(now - 60_000).toISOString(),
      }),
      api({ id: "fresh", created_at: new Date(now).toISOString(), expires_at: null }),
    ]))

    const wrapper = mount(AnnouncementLiveList, {
      props: { pane: true },
      global: { stubs: { PhMegaphone: true, PhTrash: true } },
    })
    await flushPromises()

    const meta = wrapper.findAll(".announcement-live__meta").map((node) => node.text()).join(" | ")
    expect(meta).toContain("just now")
    expect(meta).toContain("until removed")
    expect(meta).toContain("2 min ago")
    expect(meta).toContain("expires in 5 min")
    expect(meta).toContain("3 h ago")
    expect(meta).toContain("expires in 3 h")
    expect(meta).toMatch(/[A-Z][a-z]{2} \d+/)
    expect(wrapper.text()).not.toContain("expired")
  })

  it("removes an announcement and explains failures", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json([api({ id: "remove-me" })]))
    vi.mocked(fetch).mockResolvedValueOnce(json({ message: "removed" }))
    const wrapper = mount(AnnouncementLiveList, {
      global: { stubs: { PhMegaphone: true, PhTrash: true } },
    })
    await flushPromises()
    await wrapper.find(".announcement-live__remove").trigger("click")
    await flushPromises()
    expect(useAnnouncements().announcements.value).toEqual([])

    vi.mocked(fetch).mockResolvedValueOnce(json([api({ id: "keep-me" })]))
    useAnnouncements().upsertAnnouncement({
      id: "keep-me",
      householdId: "h1",
      message: "Keep me",
      createdBy: null,
      authorName: null,
      createdAt: "2026-06-01T18:00:00Z",
      expiresAt: null,
    })
    const removeSpy = vi
      .spyOn(announcementsApi, "remove")
      .mockRejectedValueOnce(new Error("Server said no"))
    const failed = mount(AnnouncementLiveList, {
      global: { stubs: { PhMegaphone: true, PhTrash: true } },
    })
    await flushPromises()
    expect(failed.findAll(".announcement-live__item")).toHaveLength(1)
    await failed.find(".announcement-live__remove").trigger("click")
    await flushPromises()
    expect(failed.find(".announcement-live__error").text()).toBe("Server said no")

    removeSpy.mockRejectedValueOnce("nope")
    await failed.find(".announcement-live__remove").trigger("click")
    await flushPromises()
    expect(failed.find(".announcement-live__error").text()).toBe(
      "Could not remove the announcement",
    )
  })
})

describe("AnnouncementComposer", () => {
  it("sends a message and shows the confirmation until the timer clears it", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
    try {
      vi.spyOn(announcementsApi, "create").mockResolvedValueOnce({
        id: "new",
        householdId: "h1",
        message: "Dinner is ready",
        createdBy: null,
        authorName: null,
        createdAt: "2026-06-01T18:00:00Z",
        expiresAt: null,
      })
      const wrapper = mount(AnnouncementComposer)
      await flushPromises()

      await wrapper.find("#announcement-message").setValue("Dinner is ready")
      await wrapper.find("form").trigger("submit")
      await flushPromises()

      expect(wrapper.find(".ac-sent").exists()).toBe(true)
      expect(vi.mocked(announcementsApi.create)).toHaveBeenCalledWith(
        expect.objectContaining({ message: "Dinner is ready" }),
      )
      await vi.advanceTimersByTimeAsync(4000)
      expect(wrapper.find(".ac-sent").exists()).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it("shows a non-Error failure and wires the select/toggle controls", async () => {
    vi.spyOn(announcementsApi, "create").mockRejectedValueOnce("nope")
    const wrapper = mount(AnnouncementComposer)
    await flushPromises()

    await wrapper.find("#announcement-message").setValue("Hello")
    await wrapper.find("form").trigger("submit")
    await flushPromises()
    expect(wrapper.find(".ac-error").text()).toBe("Could not send the announcement")

    const selects = wrapper.findAll("select")
    await selects[0]!.setValue("m1")
    await selects[1]!.setValue("never")
    const toggle = wrapper.findComponent({ name: "UiToggle" })
    toggle.vm.$emit("update:modelValue", false)
    await flushPromises()
    expect(wrapper.find(".ac-counter").text()).toBe("5/500")
  })
})
