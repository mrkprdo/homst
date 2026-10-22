import { describe, it, expect, vi } from "vitest"
import { mount, flushPromises, type VueWrapper } from "@vue/test-utils"
import MemberDetailPanel from "@/components/profile/MemberDetailPanel.vue"
import { useSettings } from "@/composables/useSettings"

/** A tiny stateful server so save → remount behaves like the real API. */
function installStatefulFetch(members?: Record<string, unknown>[]) {
  const state = {
    settings: { houseName: "Old Home", address: "1 Old St" } as Record<string, unknown>,
    members: members ?? [
      {
        id: "m1", household_id: "h", name: "Alice", avatar_url: null,
        color: "#fcd0a1", role: "member", joined_at: "2026-01-01T00:00:00Z",
      },
    ],
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
})
