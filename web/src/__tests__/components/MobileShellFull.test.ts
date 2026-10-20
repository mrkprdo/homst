import { describe, it, expect, vi, beforeEach } from "vitest"
import { nextTick } from "vue"
import { mount, flushPromises } from "@vue/test-utils"
import { setLowPower } from "@/lib/motion"
import { useEvents, type Event } from "@/composables/useEvents"
import { useMembers, type Member } from "@/composables/useMembers"
import MobileShell from "@/components/mobile/MobileShell.vue"
import MobileCalendarView from "@/components/mobile/MobileCalendarView.vue"
import MobileTasksView from "@/components/mobile/MobileTasksView.vue"

const UNASSIGNED = "var(--color-borderStrong)"

function member(id: string, color: string): Member {
  return { id, householdId: "h", name: "Alice", avatarUrl: null, color, role: "admin", joinedAt: "" }
}

/** An event on the selected day; the agenda shows past times too. */
function event(o: Record<string, unknown> = {}): Event {
  const start = new Date()
  start.setHours(12, 0, 0, 0)
  return {
    id: "e1", calendarId: "c1", title: "Event", description: "",
    startAt: start.toISOString(), endAt: start.toISOString(), allDay: false, recurrence: null,
    source: "internal", externalUid: null, createdBy: null, createdAt: "", updatedAt: "",
    ...o,
  }
}

function installEvent(outcome: "accepted" | "dismissed") {
  const e: any = new Event("beforeinstallprompt")
  e.prompt = vi.fn()
  e.userChoice = Promise.resolve({ outcome })
  return e
}

/** Re-render so template-only state is re-read. */
async function forceRender(w: any) {
  await w.findAll(".ms-tab")[1].trigger("click")
  await w.findAll(".ms-tab")[0].trigger("click")
}

beforeEach(() => {
  setLowPower(true)
  vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify([]), { status: 200 }))
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  })
})

describe("MobileShell — navigation, install banner and day agenda", () => {
  it("renders the day agenda with assignee colours and all-day labels", async () => {
    const ev = useEvents()
    const mb = useMembers()

    mb.upsertMember(member("m1", "#b1b695"))
    mb.upsertMember(member("m2", "sage"))

    ev.upsertEvent(event({ id: "e1", title: "Timed", allDay: false, assigneeId: "m1" }))
    ev.upsertEvent(event({ id: "e2", title: "Ghost", allDay: true, assigneeId: "ghost" }))
    ev.upsertEvent(event({ id: "e3", title: "Bare", allDay: true, assigneeId: undefined }))
    ev.upsertEvent(event({ id: "e4", title: "Named", allDay: true, assigneeId: "m2" }))

    const w = mount(MobileShell)
    await flushPromises()

    // All-day entries sort first, then timed ones
    const items = w.findAll(".mc-event")
    expect(items.length).toBe(4)

    const dot = (i: number) => items[i]!.find(".mc-event-dot").attributes("style")!
    expect(dot(0)).toContain(UNASSIGNED) // unknown member id
    expect(dot(1)).toContain(UNASSIGNED) // no assignee at all
    expect(dot(2)).not.toContain(UNASSIGNED) // named colour resolved to a hex
    expect(dot(3)).toContain("rgb(177, 182, 149)") // hex colour kept as-is

    // only timed events print a clock time
    expect(items[0]!.find(".mc-event-time").text()).toBe("All day")
    expect(items[1]!.find(".mc-event-time").text()).toBe("All day")
    expect(items[2]!.find(".mc-event-time").text()).toBe("All day")
    expect(items[3]!.find(".mc-event-time").text()).toMatch(/\d/)

    expect(w.find(".mc-agenda-date").text()).toContain("Today")
    expect(w.find(".mc-agenda-count").text()).toBe("4 events")

    w.unmount()
  })

  it("moves between Events and Tasks with the bottom navigation", async () => {
    const w = mount(MobileShell)
    await flushPromises()

    const tabs = w.findAll(".ms-tab")
    expect(tabs).toHaveLength(2)
    expect(tabs[0]!.attributes("aria-current")).toBe("page")
    expect(w.findComponent(MobileCalendarView).exists()).toBe(true)

    await tabs[1]!.trigger("click")
    expect(tabs[1]!.attributes("aria-current")).toBe("page")
    expect(w.findComponent(MobileTasksView).exists()).toBe(true)
    expect(w.findComponent(MobileCalendarView).exists()).toBe(false)

    w.unmount()
  })

  it("only offers install when the browser can actually prompt", async () => {
    const w = mount(MobileShell)
    await flushPromises()
    expect(w.find(".ms-install-banner").exists()).toBe(false)

    const promptEvent = installEvent("accepted")
    window.dispatchEvent(promptEvent)
    await nextTick()
    await forceRender(w)
    await nextTick()

    const action = w.find(".ms-install-action")
    expect(action.exists()).toBe(true)
    await action.trigger("click")
    await flushPromises()

    expect(promptEvent.prompt).toHaveBeenCalled()
    expect(w.find(".ms-install-banner").exists()).toBe(false)
    w.unmount()
  })

  it("closes the install banner once the native prompt is answered", async () => {
    const w = mount(MobileShell)
    await flushPromises()

    const promptEvent = installEvent("dismissed")
    window.dispatchEvent(promptEvent)
    await nextTick()
    await forceRender(w)
    await nextTick()
    await w.find(".ms-install-action").trigger("click")
    await flushPromises()
    expect(promptEvent.prompt).toHaveBeenCalled()
    expect(w.find(".ms-install-banner").exists()).toBe(false)

    // switching between the two views keeps the list in sync
    await w.findAll(".ms-tab")[1].trigger("click")
    expect(w.find(".mt-state").text()).toContain("No tasks yet")
    await w.findAll(".ms-tab")[0].trigger("click")
    expect(w.find(".mc-state").text()).toContain("Nothing scheduled")

    w.unmount()
  })

  it("hides the banner when dismissed without installing", async () => {
    const w = mount(MobileShell)
    await flushPromises()

    window.dispatchEvent(installEvent("accepted"))
    await nextTick()
    await forceRender(w)
    await nextTick()
    expect(w.find(".ms-install-banner").exists()).toBe(true)

    await w.find(".ms-install-dismiss").trigger("click")
    await nextTick()
    expect(w.find(".ms-install-banner").exists()).toBe(false)

    w.unmount()
  })

  it("hides the install banner when running as a standalone app", async () => {
    const mm = window.matchMedia
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: vi.fn((q: string) => ({ matches: q.includes("standalone"), addEventListener: vi.fn(), removeEventListener: vi.fn() })),
    })
    try {
      vi.resetModules()
      const { default: FreshShell } = await import("@/components/mobile/MobileShell.vue")
      const w = mount(FreshShell)
      await flushPromises()
      expect(w.find(".ms-install-banner").exists()).toBe(false)
      w.unmount()
    } finally {
      Object.defineProperty(window, "matchMedia", { configurable: true, writable: true, value: mm })
    }
  })
})
