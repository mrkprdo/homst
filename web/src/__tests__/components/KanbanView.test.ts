import { describe, it, expect, vi } from "vitest"
import { mount, flushPromises } from "@vue/test-utils"
import { nextTick } from "vue"
import KanbanView from "@/components/kanban/KanbanView.vue"
import { useTasks } from "@/composables/useTasks"
import { useUi } from "@/composables/useUi"

type Status = "todo" | "doing" | "done"

function makeTask(id: string, status: Status, title = id) {
  return {
    id, listId: "l1", title, description: "",
    startAt: null, endAt: null, assigneeId: null, status,
    priority: "medium" as const, position: 0, createdBy: "u1", createdAt: "", updatedAt: "",
  }
}

/** Queue a successful PATCH /tasks/:id response that echoes the requested status. */
function mockTaskPatch(id: string) {
  vi.mocked(fetch).mockImplementationOnce(async (_url, options) => {
    const body = JSON.parse(String((options as RequestInit | undefined)?.body ?? "{}"))
    return new Response(JSON.stringify({
      id, list_id: "l1", title: id, description: "",
      assignee_id: null, start_at: null, end_at: null,
      status: body.status, priority: "medium", position: 0,
      created_by: null, created_at: "", updated_at: "",
    }), { status: 200, headers: { "content-type": "application/json" } })
  })
}

describe("KanbanView", () => {
  it("renders tasks title", () => {
    const wrapper = mount(KanbanView)
    expect(wrapper.find(".page-header__title").text()).toBe("Tasks")
  })

  it("renders 3 columns (To Do, Doing, Done)", () => {
    const wrapper = mount(KanbanView)
    const cols = wrapper.findAll(".tasks-column")
    expect(cols).toHaveLength(3)
  })

  it("column headers show To Do, Doing, Done", () => {
    const wrapper = mount(KanbanView)
    const headers = wrapper.findAll(".column-title")
    expect(headers).toHaveLength(3)
    expect(headers[0]!.text()).toBe("To Do")
    expect(headers[1]!.text()).toBe("Doing")
    expect(headers[2]!.text()).toBe("Done")
  })

  it("counts show 0 by default", () => {
    const wrapper = mount(KanbanView)
    const badges = wrapper.findAllComponents({ name: "UiBadge" })
    expect(badges[0]!.text()).toBe("0")
  })

  it("counts reflect store tasks", async () => {
    const { upsertTask } = useTasks()
    upsertTask({
      id: "t1", listId: "l1", title: "Task 1", description: "",
      startAt: null, endAt: null, assigneeId: null, status: "todo", priority: "medium",
      position: 0, createdBy: "u1", createdAt: "", updatedAt: "",
    })
    upsertTask({
      id: "t2", listId: "l1", title: "Task 2", description: "",
      startAt: null, endAt: null, assigneeId: null, status: "doing", priority: "medium",
      position: 0, createdBy: "u1", createdAt: "", updatedAt: "",
    })

    const wrapper = mount(KanbanView)
    const badges = wrapper.findAllComponents({ name: "UiBadge" })
    expect(badges[0]!.text()).toBe("1")
    expect(badges[1]!.text()).toBe("1")
    expect(badges[2]!.text()).toBe("0")
  })

  it("renders TaskCard for each task", async () => {
    const { upsertTask } = useTasks()
    upsertTask({
      id: "t1", listId: "l1", title: "Buy milk", description: "",
      startAt: null, endAt: null, assigneeId: null, status: "todo", priority: "high",
      position: 0, createdBy: "u1", createdAt: "", updatedAt: "",
    })

    const wrapper = mount(KanbanView)
    const cards = wrapper.findAllComponents({ name: "TaskCard" })
    expect(cards.length).toBeGreaterThanOrEqual(1)
  })

  it("Add button opens quick-add drawer", async () => {
    const wrapper = mount(KanbanView)
    const ui = useUi()
    const addBtn = wrapper.findComponent({ name: "UiButton" })
    await addBtn.trigger("click")
    expect(ui.isDrawerOpen.value).toBe(true)
    expect(ui.drawer.value.type).toBe("quick-add")
  })

  it("renders PageHeader", () => {
    const wrapper = mount(KanbanView)
    expect(wrapper.findComponent({ name: "PageHeader" }).exists()).toBe(true)
  })

  it("renders done tasks with done prop on TaskCard", () => {
    const { upsertTask } = useTasks()
    upsertTask({
      id: "t1", listId: "l1", title: "Completed task", description: "",
      startAt: null, endAt: null, assigneeId: null, status: "done", priority: "low",
      position: 0, createdBy: "u1", createdAt: "", updatedAt: "",
    })
    upsertTask({
      id: "t2", listId: "l1", title: "Another done", description: "",
      startAt: null, endAt: null, assigneeId: null, status: "done", priority: "medium",
      position: 1, createdBy: "u1", createdAt: "", updatedAt: "",
    })

    const wrapper = mount(KanbanView)
    const badges = wrapper.findAllComponents({ name: "UiBadge" })
    expect(badges[2]!.text()).toBe("2")

    const cards = wrapper.findAllComponents({ name: "TaskCard" })
    expect(cards.length).toBeGreaterThanOrEqual(2)
  })

  it("renders tasks with due dates in all columns", () => {
    const { upsertTask } = useTasks()
    upsertTask({
      id: "t1", listId: "l1", title: "Todo with date", description: "",
      startAt: "2026-05-15T00:00:00Z", endAt: null, assigneeId: null, status: "todo", priority: "high",
      position: 0, createdBy: "u1", createdAt: "", updatedAt: "",
    })
    upsertTask({
      id: "t2", listId: "l1", title: "Doing with date", description: "",
      startAt: "2026-06-01T00:00:00Z", endAt: null, assigneeId: null, status: "doing", priority: "medium",
      position: 0, createdBy: "u1", createdAt: "", updatedAt: "",
    })
    upsertTask({
      id: "t3", listId: "l1", title: "Done with date", description: "",
      startAt: "2026-07-04T00:00:00Z", endAt: null, assigneeId: null, status: "done", priority: "low",
      position: 0, createdBy: "u1", createdAt: "", updatedAt: "",
    })

    const wrapper = mount(KanbanView)
    const badges = wrapper.findAllComponents({ name: "UiBadge" })
    expect(badges[0]!.text()).toBe("1")
    expect(badges[1]!.text()).toBe("1")
    expect(badges[2]!.text()).toBe("1")
    expect(wrapper.findAllComponents({ name: "TaskCard" })).toHaveLength(3)
  })

  it("clicking a card opens the task-detail drawer", async () => {
    const { upsertTask } = useTasks()
    upsertTask(makeTask("t1", "todo", "Buy milk"))

    const wrapper = mount(KanbanView)
    await flushPromises()
    await wrapper.findAllComponents({ name: "TaskCard" })[0]!.trigger("click")

    const ui = useUi()
    expect(ui.drawer.value.type).toBe("task-detail")
    expect(ui.drawer.value.id).toBe("t1")
  })

  it("moves a To Do task to Doing", async () => {
    const { upsertTask, todos, doing } = useTasks()
    upsertTask(makeTask("t-todo", "todo"))

    const wrapper = mount(KanbanView)
    await flushPromises()

    mockTaskPatch("t-todo")
    await wrapper.find('.move-btn[title="Move to Doing"]').trigger("click")
    await flushPromises()

    expect(todos.value).toHaveLength(0)
    expect(doing.value.some(t => t.id === "t-todo")).toBe(true)
  })

  it("moves a Doing task to Done", async () => {
    const { upsertTask, doing, done } = useTasks()
    upsertTask(makeTask("t-doing", "doing"))

    const wrapper = mount(KanbanView)
    await flushPromises()

    mockTaskPatch("t-doing")
    await wrapper.find('.move-btn[title="Move to Done"]').trigger("click")
    await flushPromises()

    expect(doing.value).toHaveLength(0)
    expect(done.value.some(t => t.id === "t-doing")).toBe(true)
  })

  it("moves a Doing task back to To Do", async () => {
    const { upsertTask, todos, doing } = useTasks()
    upsertTask(makeTask("t-doing", "doing"))

    const wrapper = mount(KanbanView)
    await flushPromises()

    mockTaskPatch("t-doing")
    await wrapper.find('.move-btn[title="Move to To Do"]').trigger("click")
    await flushPromises()

    expect(doing.value).toHaveLength(0)
    expect(todos.value.some(t => t.id === "t-doing")).toBe(true)
  })

  it("moves a Done task back to Doing", async () => {
    const { upsertTask, doing, done } = useTasks()
    upsertTask(makeTask("t-done", "done"))

    const wrapper = mount(KanbanView)
    await flushPromises()

    mockTaskPatch("t-done")
    await wrapper.find('.move-btn[title="Move to Doing"]').trigger("click")
    await flushPromises()

    expect(done.value).toHaveLength(0)
    expect(doing.value.some(t => t.id === "t-done")).toBe(true)
  })

  it("a failed move leaves the task in place", async () => {
    const { upsertTask, todos, doing } = useTasks()
    upsertTask(makeTask("t-todo", "todo"))

    const wrapper = mount(KanbanView)
    await flushPromises()

    vi.mocked(fetch).mockImplementationOnce(async () => {
      throw new Error("offline")
    })
    await wrapper.find('.move-btn[title="Move to Doing"]').trigger("click")
    await flushPromises()

    expect(doing.value).toHaveLength(0)
    expect(todos.value.some(t => t.id === "t-todo")).toBe(true)
  })
})
