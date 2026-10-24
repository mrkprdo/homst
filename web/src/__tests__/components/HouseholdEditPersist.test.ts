import { describe, it, expect, vi } from "vitest"
import { mount, flushPromises, type VueWrapper } from "@vue/test-utils"
import MemberDetailPanel from "@/components/profile/MemberDetailPanel.vue"
import { useSettings } from "@/composables/useSettings"

/** A tiny stateful server so save → remount behaves like the real API. */
function installStatefulFetch(
  members?: Record<string, unknown>[],
  options: { failDelete?: boolean } = {},
) {
  const state = {
    settings: { houseName: "Old Home", address: "1 Old St" } as Record<string, unknown>,
    members: members ?? [
      {
        id: "m1", household_id: "h", name: "Alice", avatar_url: null,
        color: "#fcd0a1", role: "member", joined_at: "2026-01-01T00:00:00Z",
      },
    ],
    failDelete: options.failDelete ?? false,
  }

  vi.mocked(fetch).mockImplementation(async (url, options) => {
    const u = String(url)
    const method = (options?.method as string) || "GET"
    const body = options?.body ? JSON.parse(options.body as string) : {}

    if (u.includes("/household/settings") && method === "GET") {
      return new Response(JSON.stringify(state.settings), { status: 200 })
    }
    if (u.includes("/household/settings") && method === "PATCH") {
      Object.assign(state.settings, body.settings ?? {})
      return new Response(JSON.stringify({ message: "ok" }), { status: 200 })
    }
    if (u.includes("/household/members") && method === "GET") {
      return new Response(JSON.stringify(state.members), { status: 200 })
    }
    if (u.includes("/household/members") && method === "DELETE") {
      if (state.failDelete) {
        return new Response(JSON.stringify({ detail: "boom" }), { status: 500 })
      }
      const id = u.split("/").pop()
      const index = state.members.findIndex((m) => m.id === id)
      if (index >= 0) state.members.splice(index, 1)
      return new Response(JSON.stringify({ message: "Member deleted" }), { status: 200 })
    }
    if (u.includes("/household/members") && method === "PATCH") {
      const id = u.split("/").pop()
      const member = state.members.find((m) => m.id === id)
      if (member) Object.assign(member, body)
      return new Response(JSON.stringify(member ?? {}), { status: 200 })
    }
    return new Response(JSON.stringify([]), { status: 200 })
  })

  return state
}

function memberRow(id: string, name: string) {
  return {
    id, household_id: "h", name, avatar_url: null,
    color: null, role: "member", joined_at: "2026-01-01T00:00:00Z",
  }
}

const ALICE_ID = "11111111-1111-4111-8111-111111111111"
const BOB_ID = "22222222-2222-4222-8222-222222222222"
const CAROL_ID = "33333333-3333-4333-8333-333333333333"

function deleteCalls() {
  return vi.mocked(fetch).mock.calls.filter(
    ([, init]) => (init as RequestInit | undefined)?.method === "DELETE",
  )
}

function section(wrapper: VueWrapper, label: string) {
  return wrapper.findAll(".md-section").find(s => s.find(".md-label").text() === label)!
}

async function mountPanel() {
  const wrapper = mount(MemberDetailPanel, { global: { stubs: { teleport: true } } })
  await flushPromises()
  return wrapper
}

describe("household edit persistence", () => {
  it("persists the house name from the inline Save and survives remount", async () => {
    const state = installStatefulFetch()

    const wrapper = await mountPanel()
    expect(wrapper.text()).toContain("Old Home")

    await section(wrapper, "Household").find(".md-edit").trigger("click")
    await section(wrapper, "Household").find("input").setValue("New Home")
    await section(wrapper, "Household").findAll("button").find(b => b.text() === "Save")!.trigger("click")
    await flushPromises()

    // The inline Save itself hit the server and updated the shared store.
    expect(state.settings.houseName).toBe("New Home")
    expect(useSettings().houseName.value).toBe("New Home")
    // No dirty fields remain, so the full-save button should be gone.
    expect(wrapper.find(".md-save-btn").exists()).toBe(false)
    wrapper.unmount()

    const reopened = await mountPanel()
    expect(reopened.text()).toContain("New Home")
    expect(reopened.text()).not.toContain("Old Home")
  })

  it("clears the dirty state after an inline save when members have no color", async () => {
    installStatefulFetch([
      { id: "m1", household_id: "h", name: "Alice", avatar_url: null, color: null, role: "member", joined_at: "2026-01-01T00:00:00Z" },
      { id: "m2", household_id: "h", name: "Bob", avatar_url: null, color: null, role: "member", joined_at: "2026-01-01T00:00:00Z" },
      { id: "m3", household_id: "h", name: "Carol", avatar_url: null, color: null, role: "member", joined_at: "2026-01-01T00:00:00Z" },
    ])

    const wrapper = await mountPanel()
    await section(wrapper, "Household").find(".md-edit").trigger("click")
    await section(wrapper, "Household").find("input").setValue("New Home")
    await section(wrapper, "Household").findAll("button").find(b => b.text() === "Save")!.trigger("click")
    await flushPromises()

    expect(wrapper.find(".md-save-btn").exists()).toBe(false)
  })

  it("persists a member rename through the main Save Changes flow", async () => {
    const state = installStatefulFetch()

    const wrapper = await mountPanel()
    const input = wrapper.find(".md-member-row input")
    await input.setValue("Alicia")
    await wrapper.find(".md-save-btn").trigger("click")
    await wrapper.find(".md-confirm-actions").findAll("button")[0]!.trigger("click")
    await flushPromises()

    expect(state.members[0]!.name).toBe("Alicia")
    wrapper.unmount()

    const reopened = await mountPanel()
    expect((reopened.find(".md-member-row input").element as HTMLInputElement).value).toBe("Alicia")
  })

  it("persists a member deletion and keeps it gone after remount", async () => {
    const state = installStatefulFetch([
      memberRow(ALICE_ID, "Alice"),
      memberRow(BOB_ID, "Bob"),
      memberRow(CAROL_ID, "Carol"),
    ])

    const wrapper = await mountPanel()
    expect(wrapper.text()).toContain("Members (3)")

    await wrapper.findAll(".md-member")[1]!.find(".member-remove").trigger("click")
    expect(wrapper.text()).toContain("Members (2)")
    await wrapper.find(".md-save-btn").trigger("click")
    await wrapper.find(".md-confirm-actions").findAll("button")[0]!.trigger("click")
    await flushPromises()

    // The DELETE reached the server for the member that was actually removed.
    expect(deleteCalls().map(([u]) => String(u))).toEqual([
      `/api/v1/household/members/${BOB_ID}`,
    ])
    expect(state.members.map((m) => m.name)).toEqual(["Alice", "Carol"])
    wrapper.unmount()

    // Reopening the drawer refetches, like the real app does.
    const reopened = await mountPanel()
    expect(reopened.text()).toContain("Members (2)")
    expect(reopened.findAll(".md-member-row input").map(
      (i) => (i.element as HTMLInputElement).value,
    )).toEqual(["Alice", "Carol"])
  })

  it("does not claim a deletion saved when the DELETE fails", async () => {
    const state = installStatefulFetch([
      memberRow(ALICE_ID, "Alice"),
      memberRow(BOB_ID, "Bob"),
      memberRow(CAROL_ID, "Carol"),
    ], { failDelete: true })

    const wrapper = await mountPanel()
    await wrapper.findAll(".md-member")[0]!.find(".member-remove").trigger("click")
    await wrapper.find(".md-save-btn").trigger("click")
    await wrapper.find(".md-confirm-actions").findAll("button")[0]!.trigger("click")
    await flushPromises()

    expect(wrapper.text()).toContain("Couldn't remove that member")
    expect(wrapper.text()).not.toContain("Changes saved")
    expect(state.members.map((m) => m.name)).toEqual(["Alice", "Bob", "Carol"])

    // The removal stays pending, so a retry can finish it once the API recovers.
    state.failDelete = false
    await wrapper.find(".md-save-btn").trigger("click")
    await wrapper.find(".md-confirm-actions").findAll("button")[0]!.trigger("click")
    await flushPromises()

    expect(wrapper.text()).toContain("Changes saved")
    expect(state.members.map((m) => m.name)).toEqual(["Bob", "Carol"])
  })
})
