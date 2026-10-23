import { describe, it, expect, vi, beforeEach } from "vitest"
import { mount, flushPromises, type VueWrapper } from "@vue/test-utils"
import { nextTick } from "vue"
import MemberDetailPanel from "@/components/profile/MemberDetailPanel.vue"
import { useMembers } from "@/composables/useMembers"
import { useUi } from "@/composables/useUi"

const MEMBERS = [
  {
    id: "m1", household_id: "h", name: "Alice", avatar_url: null,
    color: "#fcd0a1", role: "member", joined_at: "2026-01-01T00:00:00Z",
  },
]

interface Options {
  settings?: Record<string, unknown>
  members?: unknown[]
  failSettingsGet?: boolean
  failMembersGet?: boolean
  failSettingsPatch?: boolean
  failMemberPost?: boolean
}

function installFetch(options: Options = {}) {
  const {
    settings = {
      houseName: "Cedar House",
      address: "1 Main St",
      holidayCountry: "CA",
      holidayProvince: "Ontario",
      lat: 43.6532,
      lon: -79.3832,
    },
    members = MEMBERS,
    failSettingsGet = false,
    failMembersGet = false,
    failSettingsPatch = false,
    failMemberPost = false,
  } = options

  vi.mocked(fetch).mockImplementation(async (url, init) => {
    const path = String(url)
    const method = (init?.method as string) || "GET"
    if (path.includes("/household/settings") && method === "GET") {
      if (failSettingsGet) return new Response(JSON.stringify({ detail: "nope" }), { status: 500 })
      return new Response(JSON.stringify(settings), { status: 200 })
    }
    if (path.includes("/household/settings") && method === "PATCH") {
      if (failSettingsPatch) return new Response(JSON.stringify({ detail: "nope" }), { status: 500 })
      return new Response(JSON.stringify({ message: "ok" }), { status: 200 })
    }
    if (path.includes("/household/members") && method === "GET") {
      if (failMembersGet) return new Response(JSON.stringify({ detail: "nope" }), { status: 500 })
      return new Response(JSON.stringify(members), { status: 200 })
    }
    if (path.includes("/household/members") && method === "POST") {
      if (failMemberPost) return new Response(JSON.stringify({ detail: "nope" }), { status: 500 })
      return new Response(JSON.stringify({
        id: "new-1", household_id: "h", name: "New", avatar_url: null,
        color: "#b1b695", role: "member", joined_at: "2030-01-01T00:00:00Z",
      }), { status: 201 })
    }
    if (path.includes("/household/members") && method === "PATCH") {
      return new Response(JSON.stringify(MEMBERS[0]), { status: 200 })
    }
    if (path.includes("/household/members") && method === "DELETE") {
      return new Response(null, { status: 204 })
    }
    if (path.includes("/photos") && method === "POST") {
      return new Response(JSON.stringify({
        id: "p2", url: "/uploads/photos/new.png", selected: true, created_at: "",
      }), { status: 201 })
    }
    return new Response(JSON.stringify([]), { status: 200 })
  })
}

function section(wrapper: VueWrapper, label: string) {
  return wrapper.findAll(".md-section").find(s => s.find(".md-label").text() === label)!
}

async function mountPanel() {
  const wrapper = mount(MemberDetailPanel, { global: { stubs: { teleport: true } } })
  await flushPromises()
  return wrapper
}

beforeEach(() => {
  vi.mocked(fetch).mockReset()
})

describe("MemberDetailPanel residual", () => {
  it("falls back to empty settings and members when the API fails", async () => {
    installFetch({ failSettingsGet: true, failMembersGet: true })
    const wrapper = await mountPanel()
    expect(wrapper.text()).toContain("Members (1)")
    expect(section(wrapper, "Household").text()).toContain("Unnamed")
  })

  it("reports an inline save failure", async () => {
    installFetch({ failSettingsPatch: true })
    const wrapper = await mountPanel()
    await section(wrapper, "Household").find(".md-edit").trigger("click")
    await section(wrapper, "Household").find("input").setValue("New Name")
    await section(wrapper, "Household").findAll("button").find(b => b.text() === "Save")!.trigger("click")
    await flushPromises()
    expect(wrapper.text()).toContain("Couldn't save that change")
  })

  it("closes inline editors without a request when nothing changed", async () => {
    installFetch({ members: [] })
    const wrapper = await mountPanel()
    for (const label of ["Household", "Address", "Country", "State / Province", "Weather Coordinates"]) {
      const target = section(wrapper, label)
      await target.find(".md-edit").trigger("click")
      await nextTick()
      await target.findAll("button").find(b => b.text() === "Save")!.trigger("click")
      await flushPromises()
      expect(target.find("input, select").exists()).toBe(false)
    }
    expect(vi.mocked(fetch).mock.calls.filter(([, init]) => (init as RequestInit)?.method === "PATCH")).toHaveLength(0)
  })

  it("folds open drafts into one save", async () => {
    installFetch({ members: [] })
    const wrapper = await mountPanel()

    await section(wrapper, "Household").find(".md-edit").trigger("click")
    await section(wrapper, "Household").find("input").setValue("New Name")
    await section(wrapper, "Address").find(".md-edit").trigger("click")
    await section(wrapper, "Address").find("input").setValue("42 Oak Ave")
    await section(wrapper, "Country").find(".md-edit").trigger("click")
    await section(wrapper, "Country").find("select").setValue("US")
    await section(wrapper, "State / Province").find(".md-edit").trigger("click")
    await section(wrapper, "State / Province").find("input").setValue("Quebec")
    await section(wrapper, "Weather Coordinates").find(".md-edit").trigger("click")
    const coords = section(wrapper, "Weather Coordinates").findAll('input[type="number"]')
    await coords[0]!.setValue("40.5")
    await coords[1]!.setValue("-73.5")

    await wrapper.find(".md-save-btn").trigger("click")
    await wrapper.find(".md-confirm-actions").findAll("button")[0]!.trigger("click")
    await flushPromises()
    expect(wrapper.text()).toContain("Changes saved")

    const bodies = vi.mocked(fetch).mock.calls
      .filter(([, init]) => (init as RequestInit)?.method === "PATCH")
      .map(([, init]) => JSON.parse((init as RequestInit).body as string).settings)
    expect(bodies.some(body => body.address === "42 Oak Ave")).toBe(true)
    expect(bodies.some(body => body.holidayCountry === "US")).toBe(true)
    expect(bodies.some(body => body.lat === 40.5 && body.lon === -73.5)).toBe(true)
  })

  it("updates the shared member store when a colour is chosen", async () => {
    installFetch({ members: MEMBERS })
    useMembers().upsertMember({
      id: "m1", householdId: "h", name: "Alice", avatarUrl: null,
      color: "#fcd0a1", role: "member", joinedAt: "",
    })
    const wrapper = await mountPanel()
    await wrapper.findAll(".md-member")[0]!.findAll(".color-opt")[3]!.trigger("click")
    expect(useMembers().members.value.find(member => member.id === "m1")!.color).not.toBe("#fcd0a1")
  })

  it("creates a member even when the create response is lost", async () => {
    installFetch({ members: [], failMemberPost: true })
    const wrapper = await mountPanel()
    await wrapper.findAll(".md-add-link").find(b => b.text().includes("Add member"))!.trigger("click")
    const row = wrapper.findAll(".md-member")[0]!
    await row.findAll("input")[0]!.setValue("Charlie")
    await wrapper.find(".md-save-btn").trigger("click")
    await wrapper.find(".md-confirm-actions").findAll("button")[0]!.trigger("click")
    await flushPromises()
    expect(wrapper.text()).toContain("Changes saved")
  })

  it("reports a whole-form save failure", async () => {
    installFetch({ failSettingsPatch: true, members: [] })
    const wrapper = await mountPanel()
    await section(wrapper, "Household").find(".md-edit").trigger("click")
    await section(wrapper, "Household").find("input").setValue("New Name")
    await wrapper.find(".md-save-btn").trigger("click")
    await wrapper.find(".md-confirm-actions").findAll("button")[0]!.trigger("click")
    await flushPromises()
    expect(wrapper.text()).toContain("Couldn't save all changes")
  })

  it("closes without confirmation when nothing changed", async () => {
    installFetch({ members: [] })
    const wrapper = await mountPanel()
    const ui = useUi()
    ui.openDrawer("member-detail")
    await nextTick()
    ui.closeDrawer()
    await nextTick()
    expect(ui.isDrawerOpen.value).toBe(false)
    wrapper.unmount()
  })

  it("switches tabs and opens the file picker", async () => {
    installFetch({ members: [] })
    const wrapper = await mountPanel()
    const click = vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => {})
    await wrapper.findAll(".profile-tab").find(b => b.text() === "Photos")!.trigger("click")
    await nextTick()
    await wrapper.find(".photo-upload-btn").trigger("click")
    expect(click).toHaveBeenCalled()
    await wrapper.findAll(".profile-tab").find(b => b.text() === "Household")!.trigger("click")
    await nextTick()
    expect(section(wrapper, "Household").exists()).toBe(true)
  })
})
