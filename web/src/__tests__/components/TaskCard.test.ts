import { describe, it, expect } from "vitest"
import { mount } from "@vue/test-utils"
import TaskCard from "@/components/ui/TaskCard.vue"
import { COLORS, PRIORITIES } from "@/__tests__/constants"

describe("TaskCard", () => {
  it("renders the title", () => {
    const wrapper = mount(TaskCard, {
      props: { title: "Buy groceries" },
    })
    expect(wrapper.text()).toContain("Buy groceries")
  })

  it("renders priority indicator", () => {
    const wrapper = mount(TaskCard, {
      props: { title: "Test", priority: "high" },
    })
    expect(wrapper.find(".task-card__priority").exists()).toBe(true)
    expect(wrapper.text()).toContain("high")
  })

  it("renders all priority levels", () => {
    for (const priority of PRIORITIES) {
      const wrapper = mount(TaskCard, { props: { title: "Test", priority } })
      expect(wrapper.find(`.priority--${priority}`).exists()).toBe(true)
    }
  })

  it("renders due date when provided", () => {
    const wrapper = mount(TaskCard, {
      props: { title: "Test", dueDate: "May 5" },
    })
    expect(wrapper.text()).toContain("May 5")
  })

  it("renders assignee initials", () => {
    const wrapper = mount(TaskCard, {
      props: { title: "Test", assigneeInitials: "JD" },
    })
    expect(wrapper.find(".task-card__assignee").text()).toBe("JD")
  })

  it("defaults to mauve color", () => {
    const wrapper = mount(TaskCard, {
      props: { title: "Test" },
    })
    expect(wrapper.classes()).toContain("task-card--mauve")
  })

  it("applies all color variants", () => {
    for (const color of COLORS) {
      const wrapper = mount(TaskCard, { props: { title: "Test", color } })
      expect(wrapper.classes()).toContain(`task-card--${color}`)
    }
  })

  it("applies done styling when done", () => {
    const wrapper = mount(TaskCard, {
      props: { title: "Test", done: true },
    })
    expect(wrapper.classes()).toContain("task-card--done")
  })

  it("does not have done class when not done", () => {
    const wrapper = mount(TaskCard, {
      props: { title: "Test" },
    })
    expect(wrapper.classes()).not.toContain("task-card--done")
  })

  it("renders edge div", () => {
    const wrapper = mount(TaskCard, {
      props: { title: "Test" },
    })
    expect(wrapper.find(".task-card__edge").exists()).toBe(true)
  })

  it("emits no custom events by default (click is on root div)", () => {
    const wrapper = mount(TaskCard, {
      props: { title: "Test" },
    })
    expect(wrapper.emitted()).toEqual({})
  })
})
