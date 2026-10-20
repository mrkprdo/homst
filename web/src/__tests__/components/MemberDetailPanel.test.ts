import { describe, it, expect, beforeEach, vi } from "vitest"
import { mount, flushPromises } from "@vue/test-utils"
import { nextTick } from "vue"
import MemberDetailPanel from "@/components/profile/MemberDetailPanel.vue"

function mockFetch(data: unknown) {
  ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
    new Response(JSON.stringify(data), { status: 200, headers: { "content-type": "application/json" } }),
  )
}

describe("MemberDetailPanel", () => {
  it("renders Household section", async () => {
    mockFetch({ houseName: "My Home", address: "123 Main St" })
    mockFetch([{ id: "m1", name: "Alice", household_id: "h1", avatar_url: null, role: "member", joined_at: "2026-01-01T00:00:00Z" }])
    const wrapper = mount(MemberDetailPanel)
    await nextTick()
    await flushPromises()
    expect(wrapper.text()).toContain("Household")
    expect(wrapper.text()).toContain("My Home")
  })

  it("displays address when provided", async () => {
    mockFetch({ houseName: "Home", address: "456 Oak Ave" })
    mockFetch([{ id: "m1", name: "Bob", household_id: "h1", avatar_url: null, role: "member", joined_at: "2026-01-01T00:00:00Z" }])
    const wrapper = mount(MemberDetailPanel)
    await nextTick()
    await flushPromises()
    expect(wrapper.text()).toContain("456 Oak Ave")
  })

  it("shows Unnamed when no house name set", async () => {
    mockFetch({})
    mockFetch([])
    const wrapper = mount(MemberDetailPanel)
    await nextTick()
    await flushPromises()
    expect(wrapper.text()).toContain("Unnamed")
  })

  it("shows default member when API returns empty list", async () => {
    mockFetch({})
    mockFetch([])
    const wrapper = mount(MemberDetailPanel)
    await nextTick()
    await flushPromises()
    expect(wrapper.text()).toContain("Members (1)")
  })

  it("displays members loaded from API", async () => {
    mockFetch({})
    mockFetch([
      { id: "m1", name: "Alice", household_id: "h1", avatar_url: null, role: "member", joined_at: "2026-01-01T00:00:00Z" },
      { id: "m2", name: "Bob", household_id: "h1", avatar_url: null, role: "member", joined_at: "2026-01-01T00:00:00Z" },
    ])
    const wrapper = mount(MemberDetailPanel)
    await nextTick()
    await flushPromises()
    expect(wrapper.text()).toContain("Members (2)")
  })

  it("adds a new member row on Add member click", async () => {
    mockFetch({})
    mockFetch([])
    const wrapper = mount(MemberDetailPanel)
    await nextTick()
    await flushPromises()
    expect(wrapper.text()).toContain("Members (1)")
    const addMemberBtn = wrapper.findAll(".md-add-link").filter(w => w.text().includes("Add member"))
    await addMemberBtn[0]!.trigger("click")
    expect(wrapper.text()).toContain("Members (2)")
  })

  it("does not remove last member", async () => {
    mockFetch({})
    mockFetch([])
    const wrapper = mount(MemberDetailPanel)
    await nextTick()
    await flushPromises()
    const removeBtns = wrapper.findAll(".member-remove")
    expect(removeBtns.length).toBe(0)
  })

  it("removes a member when remove button clicked", async () => {
    mockFetch({})
    mockFetch([])
    const wrapper = mount(MemberDetailPanel)
    await nextTick()
    await flushPromises()
    const addMemberBtn = () => wrapper.findAll(".md-add-link").filter(w => w.text().includes("Add member"))
    await addMemberBtn()[0]!.trigger("click")
    await addMemberBtn()[0]!.trigger("click")
    expect(wrapper.text()).toContain("Members (3)")
    const removeBtns = wrapper.findAll(".member-remove")
    await removeBtns[0]!.trigger("click")
    expect(wrapper.text()).toContain("Members (2)")
  })

  it("edit house name switches to input", async () => {
    mockFetch({ houseName: "My Home" })
    mockFetch([])
    const wrapper = mount(MemberDetailPanel)
    await nextTick()
    await flushPromises()
    const editBtn = wrapper.find(".md-edit")
    await editBtn.trigger("click")
    const input = wrapper.findComponent({ name: "UiInput" })
    expect(input.exists()).toBe(true)
  })

  it("saves house name and shows save button", async () => {
    mockFetch({ houseName: "Old Name" })
    mockFetch([])
    const wrapper = mount(MemberDetailPanel)
    await nextTick()
    await flushPromises()
    const editBtn = wrapper.find(".md-edit")
    await editBtn.trigger("click")

    const saveBtn = wrapper.findAllComponents({ name: "UiButton" }).find(b => b.text() === "Save")
    expect(saveBtn).toBeDefined()
  })
})
