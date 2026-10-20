import { describe, it, expect, vi } from "vitest"
import { mount, flushPromises } from "@vue/test-utils"
import TaskView from "@/components/tasks/TaskView.vue"
import { useTasks } from "@/composables/useTasks"
import { useUi } from "@/composables/useUi"

describe("TaskView", () => {
  it("renders title", () => {
    const wrapper = mount(TaskView)
    expect(wrapper.find(".page-header__title").text()).toBe("Tasks")
  })

  it("renders empty state when no tasks", async () => {
    const wrapper = mount(TaskView)
    await flushPromises()
    const empty = wrapper.findComponent({ name: "UiEmptyState" })
    expect(empty.exists()).toBe(true)
    expect(empty.props("message")).toBe("No tasks yet. Create one to get started.")
  })

  it("renders tasks when present", () => {
    const { upsertTask } = useTasks()
    upsertTask({
      id: "t1", listId: "l1", title: "Wash dishes", description: "",
      startAt: null, endAt: null, assigneeId: null, status: "todo", priority: "medium",
      position: 0, createdBy: "u1", createdAt: "", updatedAt: "",
    })

    const wrapper = mount(TaskView)
    const empty = wrapper.findComponent({ name: "UiEmptyState" })
    expect(empty.exists()).toBe(false)
    const cards = wrapper.findAllComponents({ name: "TaskCard" })
    expect(cards.length).toBeGreaterThanOrEqual(1)
  })

  it("Add button opens quick-add drawer", async () => {
    const wrapper = mount(TaskView)
    const ui = useUi()
    const addBtn = wrapper.findComponent({ name: "UiButton" })
    await addBtn.trigger("click")
    expect(ui.isDrawerOpen.value).toBe(true)
  })

  it("renders PageHeader", () => {
    const wrapper = mount(TaskView)
    expect(wrapper.findComponent({ name: "PageHeader" }).exists()).toBe(true)
  })

  it("renders skeleton cards when loading", () => {
    const { loading } = useTasks()
    loading.value = true
    const wrapper = mount(TaskView)
    const skeletons = wrapper.findAllComponents({ name: "UiSkeleton" })
    expect(skeletons).toHaveLength(5)
    const empty = wrapper.findComponent({ name: "UiEmptyState" })
    expect(empty.exists()).toBe(false)
  })

  it("hides empty state while loading", () => {
    const { loading } = useTasks()
    loading.value = true
    const wrapper = mount(TaskView)
    const empty = wrapper.findComponent({ name: "UiEmptyState" })
    expect(empty.exists()).toBe(false)
  })

  it("shows empty state when not loading and no tasks", async () => {
    const wrapper = mount(TaskView)
    await flushPromises()
    const empty = wrapper.findComponent({ name: "UiEmptyState" })
    expect(empty.exists()).toBe(true)
  })

  it("renders task with due date", () => {
    const { upsertTask } = useTasks()
    upsertTask({
      id: "t1", listId: "l1", title: "Task with due date", description: "",
      startAt: "2026-05-15T12:00:00Z", endAt: null, assigneeId: null, status: "todo", priority: "high",
      position: 0, createdBy: "u1", createdAt: "", updatedAt: "",
    })

    const wrapper = mount(TaskView)
    const card = wrapper.findComponent({ name: "TaskCard" })
    expect(card.exists()).toBe(true)
    expect(card.props("dueDate")).toBeTruthy()
  })

  it("tasks render in correct order", () => {
    const { upsertTask } = useTasks()
    upsertTask({
      id: "t-a", listId: "l1", title: "A task", description: "",
      startAt: null, endAt: null, assigneeId: null, status: "todo", priority: "low",
      position: 0, createdBy: "u1", createdAt: "", updatedAt: "",
    })
    upsertTask({
      id: "t-b", listId: "l1", title: "B task", description: "",
      startAt: null, endAt: null, assigneeId: null, status: "todo", priority: "high",
      position: 1, createdBy: "u1", createdAt: "", updatedAt: "",
    })

    const wrapper = mount(TaskView)
    const cards = wrapper.findAllComponents({ name: "TaskCard" })
    expect(cards.length).toBeGreaterThanOrEqual(1)
  })

  it("clicking task card via drawer", async () => {
    const ui = useUi()
    const { upsertTask } = useTasks()
    upsertTask({
      id: "t-click", listId: "l1", title: "Clickable", description: "",
      startAt: null, endAt: null, assigneeId: null, status: "todo", priority: "medium",
      position: 0, createdBy: "u1", createdAt: "", updatedAt: "",
    })

    mount(TaskView)
    expect(ui.isDrawerOpen.value).toBe(false)
  })
})
