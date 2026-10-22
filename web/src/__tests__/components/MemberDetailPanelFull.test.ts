import { describe, it, expect, beforeEach, vi } from "vitest"
import { mount, flushPromises, type VueWrapper } from "@vue/test-utils"
import { nextTick } from "vue"
import { setLowPower } from "@/lib/motion"
import { useUi } from "@/composables/useUi"
import { useSettings } from "@/composables/useSettings"
import MemberDetailPanel from "@/components/profile/MemberDetailPanel.vue"

const MEMBERS = [
  {
    id: "m1", household_id: "h", name: "Alice", avatar_url: null,
    color: "#fcd0a1", role: "member", joined_at: "2026-01-01T00:00:00Z",
  },
  {
    id: "m2", household_id: "h", name: "Bob", avatar_url: null,
    color: null, role: "admin", joined_at: "2026-01-02T00:00:00Z",
  },
]

function installFetch(settings: Record<string, unknown> = {}, members = MEMBERS) {
  vi.mocked(fetch).mockImplementation(async (url, options) => {
    const u = String(url)
    const method = (options?.method as string) || "GET"
    if (u.includes("/household/settings") && method === "GET") {
      return new Response(JSON.stringify(settings), { status: 200 })
    }
    if (u.includes("/household/settings") && method === "PATCH") {
      return new Response(JSON.stringify({ message: "ok" }), { status: 200 })
    }
    if (u.includes("/household/members") && method === "GET") {
      return new Response(JSON.stringify(members), { status: 200 })
    }
    if (u.includes("/household/members") && method === "POST") {
      return new Response(JSON.stringify({
        id: "new-1", household_id: "h", name: "New", avatar_url: null,
        color: "#b1b695", role: "member", joined_at: "2030-01-01T00:00:00Z",
      }), { status: 201 })
    }
    if (u.includes("/household/members") && method === "PATCH") {
      return new Response(JSON.stringify({
        id: "m1", household_id: "h", name: "Alice", avatar_url: null,
        color: "#b1b695", role: "member", joined_at: "2030-01-01T00:00:00Z",
      }), { status: 200 })
    }
    if (u.includes("/household/members") && method === "DELETE") {
      return new Response(null, { status: 204 })
    }
    if (u.includes("/photos") && method === "POST") {
      return new Response(JSON.stringify({
        id: "p2", url: "/uploads/photos/new.png", selected: true, created_at: "",
      }), { status: 201 })
    }
    if (u.includes("/photos/") && method === "PATCH") {
      return new Response(JSON.stringify({
        id: "p1", url: "/uploads/photos/a.png", selected: false, created_at: "",
      }), { status: 200 })
    }
    if (u.includes("/photos/") && method === "DELETE") {
      return new Response(null, { status: 204 })
    }
    return new Response(JSON.stringify([]), { status: 200 })
  })
}

function section(wrapper: VueWrapper, label: string) {
  return wrapper.findAll(".md-section").find(s => s.find(".md-label").text() === label)!
}

function patchCalls() {
  return vi.mocked(fetch).mock.calls.filter(
    ([, o]) => (o as RequestInit | undefined)?.method === "PATCH",
  )
}

describe("MemberDetailPanel (full)", () => {
  beforeEach(() => {
    setLowPower(true)
  })

  it("renders every household field, edits them, and saves through the confirm dialog", async () => {
    installFetch({
      houseName: "Cedar House", address: "1 Main St", holidayCountry: "CA",
      holidayProvince: "Ontario", lat: 43.6532, lon: -79.3832,
    })
    const wrapper = mount(MemberDetailPanel, { global: { stubs: { teleport: true } } })
    await flushPromises()

    expect(wrapper.text()).toContain("Cedar House")
    expect(wrapper.text()).toContain("1 Main St")
    expect(wrapper.text()).toContain("Ontario")
    expect(wrapper.text()).toContain("Canada")
    expect(wrapper.text()).toContain("43.6532")
    expect(wrapper.text()).toContain("Members (2)")
    expect((wrapper.findAll(".md-member")[0]!.findAll("input")[0]!.element as HTMLInputElement).value).toBe("Alice")

    // ── Edit house name ──
    await section(wrapper, "Household").find(".md-edit").trigger("click")
    await section(wrapper, "Household").find("input").setValue("New Name")
    await section(wrapper, "Household").findAll("button").find(b => b.text() === "Save")!.trigger("click")
    await flushPromises()
    expect(wrapper.text()).toContain("New Name")

    // ── Edit address ──
    await section(wrapper, "Address").find(".md-edit").trigger("click")
    await section(wrapper, "Address").find("input").setValue("42 Oak Ave")
    await section(wrapper, "Address").findAll("button").find(b => b.text() === "Save")!.trigger("click")
    await flushPromises()
    expect(wrapper.text()).toContain("42 Oak Ave")

    // ── Edit province ──
    await section(wrapper, "State / Province").find(".md-edit").trigger("click")
    await section(wrapper, "State / Province").find("input").setValue("Quebec")
    await section(wrapper, "State / Province").findAll("button").find(b => b.text() === "Save")!.trigger("click")
    await flushPromises()
    expect(wrapper.text()).toContain("Quebec")

    // ── Edit country via select ──
    await section(wrapper, "Country").find(".md-edit").trigger("click")
    await section(wrapper, "Country").find("select").setValue("US")
    await section(wrapper, "Country").findAll("button").find(b => b.text() === "Save")!.trigger("click")
    await flushPromises()
    expect(wrapper.text()).toContain("United States")

    // ── Edit weather coords ──
    await section(wrapper, "Weather Coordinates").find(".md-edit").trigger("click")
    const numInputs = section(wrapper, "Weather Coordinates").findAll('input[type="number"]')
    await numInputs[0]!.setValue("40.5")
    await numInputs[1]!.setValue("-73.5")
    await section(wrapper, "Weather Coordinates").findAll("button").find(b => b.text() === "Save")!.trigger("click")
    await flushPromises()
    expect(wrapper.text()).toContain("40.5000")

    // ── Member edits: color and name ──
    const memberRows = wrapper.findAll(".md-member")
    await memberRows[0]!.findAll(".color-opt")[3]!.trigger("click")
    await memberRows[0]!.findAll("input")[0]!.setValue("Alicia")
    expect((memberRows[0]!.findAll("input")[0]!.element as HTMLInputElement).value).toBe("Alicia")

    // ── Remove Bob, add a new member ──
    await memberRows[1]!.find(".member-remove").trigger("click")
    expect(wrapper.text()).toContain("Members (1)")
    await wrapper.findAll(".md-add-link").find(b => b.text().includes("Add member"))!.trigger("click")
    expect(wrapper.text()).toContain("Members (2)")

    // ── Save Changes → confirm overlay ──
    expect(wrapper.find(".md-save-btn").exists()).toBe(true)
    await wrapper.find(".md-save-btn").trigger("click")
    expect(wrapper.text()).toContain("Save changes?")
    await wrapper.find(".md-confirm-actions").findAll("button")[0]!.trigger("click")
    await flushPromises()

    expect(wrapper.text()).toContain("Changes saved")
    // Settings + member writes went out
    expect(patchCalls().some(([u]) => String(u).includes("/household/settings"))).toBe(true)
    expect(vi.mocked(fetch).mock.calls.some(([u, o]) =>
      String(u).includes("/household/members") && (o as RequestInit).method === "POST")).toBe(true)
  })

  it("add-address/province/country links and reset/discard flow", async () => {
    installFetch({ houseName: "Home" }, [])
    const wrapper = mount(MemberDetailPanel, { global: { stubs: { teleport: true } } })
    await flushPromises()

    // Add links present when unset
    expect(wrapper.text()).toContain("+ Add address")
    expect(wrapper.text()).toContain("+ Add province")
    expect(wrapper.text()).toContain("+ Add country")

    await wrapper.findAll(".md-add-link").find(b => b.text().includes("Add address"))!.trigger("click")
    await section(wrapper, "Address").find("input").setValue("9 Elm St")
    await section(wrapper, "Address").findAll("button").find(b => b.text() === "Save")!.trigger("click")
    await flushPromises()
    expect(wrapper.text()).toContain("9 Elm St")

    await wrapper.findAll(".md-add-link").find(b => b.text().includes("Add province"))!.trigger("click")
    await section(wrapper, "State / Province").find("input").setValue("BC")
    await section(wrapper, "State / Province").findAll("button").find(b => b.text() === "Save")!.trigger("click")
    await flushPromises()

    await wrapper.findAll(".md-add-link").find(b => b.text().includes("Add country"))!.trigger("click")
    await section(wrapper, "Country").find("select").setValue("US")
    await section(wrapper, "Country").findAll("button").find(b => b.text() === "Save")!.trigger("click")
    await flushPromises()

    // Leave one local edit unsaved so the close guard has something to protect.
    await wrapper.findAll(".md-add-link").find(b => b.text().includes("Add member"))!.trigger("click")

    // close guard blocks closing when dirty → Discard resets + closes
    const ui = useUi()
    ui.openDrawer("member-detail")
    await nextTick()
    ui.closeDrawer()
    await nextTick()
    expect(ui.isDrawerOpen.value).toBe(true)
    expect(wrapper.text()).toContain("Unsaved changes")

    await wrapper.find(".md-confirm-actions").findAll("button")
      .find(b => b.text() === "Discard")!.trigger("click")
    expect(ui.isDrawerOpen.value).toBe(false)
  })

  it("close guard can Save-and-close or Cancel", async () => {
    installFetch({ houseName: "Home" }, [])
    const wrapper = mount(MemberDetailPanel, { global: { stubs: { teleport: true } } })
    await flushPromises()

    // Typing a draft without pressing the inline Save must still be protected.
    await section(wrapper, "Household").find(".md-edit").trigger("click")
    await section(wrapper, "Household").find("input").setValue("Dirty")

    const ui = useUi()
    ui.openDrawer("member-detail")
    await nextTick()
    ui.closeDrawer()
    await nextTick()
    expect(wrapper.text()).toContain("Unsaved changes")

    // Cancel keeps the drawer open
    await wrapper.find(".md-confirm-actions").findAll("button")
      .find(b => b.text() === "Cancel")!.trigger("click")
    expect(ui.isDrawerOpen.value).toBe(true)

    // Save then close from the guard
    ui.closeDrawer()
    await nextTick()
    await wrapper.find(".md-confirm-actions").findAll("button")[0]!.trigger("click")
    await flushPromises()
    expect(ui.isDrawerOpen.value).toBe(false)
  })

  it("photos tab: upload, toggle selection, delete with confirmation, and empty state", async () => {
    installFetch({ houseName: "Home" }, [])
    const settings = useSettings()
    settings.photos.value = [
      { id: "p1", url: "/uploads/photos/a.png", selected: true } as never,
    ]
    const wrapper = mount(MemberDetailPanel, { global: { stubs: { teleport: true } } })
    await flushPromises()

    await wrapper.findAll(".profile-tab").find(b => b.text() === "Photos")!.trigger("click")
    await nextTick()
    expect(wrapper.find(".photo-item--selected").exists()).toBe(true)

    // Toggle selection → inline photosApi.update
    await wrapper.find(".photo-item").trigger("click")
    await flushPromises()
    expect(vi.mocked(fetch).mock.calls.some(([u, o]) =>
      String(u).includes("/photos/p1") && (o as RequestInit).method === "PATCH")).toBe(true)

    // Delete with confirmation
    await wrapper.find(".photo-delete").trigger("click")
    await nextTick()
    expect(wrapper.text()).toContain("Delete photo?")
    await wrapper.find(".md-confirm-actions").findAll("button")[0]!.trigger("click")
    await flushPromises()
    expect(settings.photos.value).toHaveLength(0)
    expect(wrapper.text()).toContain("No photos uploaded yet")

    // Upload a file
    const fileInput = wrapper.find('input[type="file"]')
    const file = new File(["bytes"], "new.png", { type: "image/png" })
    Object.defineProperty(fileInput.element, "files", { value: [file], configurable: true })
    await fileInput.trigger("change")
    await flushPromises()
    expect(settings.photos.value.some(p => p.id === "p2")).toBe(true)
  })

  it("handles photo upload failure gracefully", async () => {
    installFetch({ houseName: "Home" }, [])
    vi.mocked(fetch).mockImplementation(async (url, options) => {
      const u = String(url)
      const method = (options?.method as string) || "GET"
      if (u.includes("/photos") && method === "POST") {
        return new Response(JSON.stringify({ detail: "nope" }), { status: 500 })
      }
      if (u.includes("/household/settings")) return new Response("{}", { status: 200 })
      return new Response(JSON.stringify([]), { status: 200 })
    })
    const wrapper = mount(MemberDetailPanel, { global: { stubs: { teleport: true } } })
    await flushPromises()
    await wrapper.findAll(".profile-tab").find(b => b.text() === "Photos")!.trigger("click")

    const fileInput = wrapper.find('input[type="file"]')
    const file = new File(["bytes"], "bad.png", { type: "image/png" })
    Object.defineProperty(fileInput.element, "files", { value: [file], configurable: true })
    await fileInput.trigger("change")
    await flushPromises()
    expect(useSettings().photos.value).toHaveLength(0)
  })
})
