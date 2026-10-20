import { describe, it, expect, beforeEach, vi } from "vitest"
import { mount } from "@vue/test-utils"
import QuickAddForm from "@/components/shared/QuickAddForm.vue"
import { useUi } from "@/composables/useUi"
import { useEvents } from "@/composables/useEvents"
import { useTasks } from "@/composables/useTasks"
import { useSettings } from "@/composables/useSettings"

describe("QuickAddForm", () => {
  describe("Event form (calendar panel active)", () => {
    beforeEach(() => {
      const ui = useUi()
      ui.activePanel.value = "calendar"

      const { upsertCalendar } = useEvents()
      upsertCalendar({
        id: "cal-default", householdId: "h-1", name: "Family",
        color: "forest", source: "internal", feedUrl: null,
        isVisible: true, createdBy: "u-1",
      })
    })

    it("renders event title input", () => {
      const wrapper = mount(QuickAddForm)
      const input = wrapper.find("input[placeholder='Event title']")
      expect(input.exists()).toBe(true)
    })

    it("prefills the reminder from the household default", () => {
      useSettings().updateDefaultReminderMinutes(30)
      const wrapper = mount(QuickAddForm)
      const field = wrapper.findAll(".ui-field").find(f => f.text().includes("Remind me"))
      const select = field!.find("select")
      expect((select.element as HTMLSelectElement).value).toBe("30")
    })

    it("defaults the reminder to none without a household default", () => {
      const wrapper = mount(QuickAddForm)
      const field = wrapper.findAll(".ui-field").find(f => f.text().includes("Remind me"))
      const select = field!.find("select")
      expect((select.element as HTMLSelectElement).value).toBe("")
    })

    it("renders calendar selector", () => {
      const wrapper = mount(QuickAddForm)
      expect(wrapper.find("select").exists()).toBe(true)
    })

    it("renders date input", () => {
      const wrapper = mount(QuickAddForm)
      expect(wrapper.find("input[type='date']").exists()).toBe(true)
    })

    it("renders time inputs", () => {
      const wrapper = mount(QuickAddForm)
      const timeInputs = wrapper.findAll("input[type='time']")
      expect(timeInputs.length).toBe(2)
    })

    it("renders all-day toggle", () => {
      const wrapper = mount(QuickAddForm)
      expect(wrapper.findComponent({ name: "UiToggle" }).exists()).toBe(true)
    })

    it("hides time inputs when all-day is toggled on", async () => {
      const wrapper = mount(QuickAddForm)
      await wrapper.findComponent({ name: "UiToggle" }).trigger("click")
      expect(wrapper.findAll("input[type='time']").length).toBe(0)
    })

    it("shows time inputs again when all-day toggled off", async () => {
      const wrapper = mount(QuickAddForm)
      const toggle = wrapper.findComponent({ name: "UiToggle" })
      await toggle.trigger("click")
      await toggle.trigger("click")
      expect(wrapper.findAll("input[type='time']").length).toBe(2)
    })

    it("renders description textarea", () => {
      const wrapper = mount(QuickAddForm)
      expect(wrapper.find("textarea").exists()).toBe(true)
    })

    it("renders Cancel and Create Event buttons", () => {
      const wrapper = mount(QuickAddForm)
      const btns = wrapper.findAllComponents({ name: "UiButton" })
      expect(btns.length).toBe(2)
      expect(btns[0]!.text()).toContain("Cancel")
      expect(btns[1]!.text()).toContain("Create Event")
    })

    it("Create Event is disabled when title is empty", () => {
      const wrapper = mount(QuickAddForm)
      const btns = wrapper.findAllComponents({ name: "UiButton" })
      expect(btns[1]!.props("disabled")).toBe(true)
    })

    it("Create Event is enabled when title is filled", async () => {
      const wrapper = mount(QuickAddForm)
      const input = wrapper.find("input[placeholder='Event title']")
      await input.setValue("Team Standup")
      const btns = wrapper.findAllComponents({ name: "UiButton" })
      expect(btns[1]!.props("disabled")).toBe(false)
    })

    it("creating an event adds to events store and closes drawer", async () => {
      const ui = useUi()
      ui.isDrawerOpen.value = true
      const { events } = useEvents()

      const wrapper = mount(QuickAddForm)
      await wrapper.find("input[placeholder='Event title']").setValue("Brunch")
      await wrapper.find("input[type='date']").setValue("2026-05-15")

      const btns = wrapper.findAllComponents({ name: "UiButton" })
      await btns[1]!.trigger("click")
      await new Promise(r => setTimeout(r, 0))

      expect(events.value).toHaveLength(1)
      expect(events.value[0]!.title).toBe("Brunch")
      expect(ui.isDrawerOpen.value).toBe(false)
    })

    it("creating event sets correct defaults", async () => {
      const ui = useUi()
      ui.isDrawerOpen.value = true
      const { events } = useEvents()

      const wrapper = mount(QuickAddForm)
      await wrapper.find("input[placeholder='Event title']").setValue("Meeting")
      const btns = wrapper.findAllComponents({ name: "UiButton" })
      await btns[1]!.trigger("click")
      await new Promise(r => setTimeout(r, 0))

      const event = events.value[0]!
      expect(event.calendarId).toBeTruthy()
      expect(event.source).toBe("internal")
      expect(event.allDay).toBe(false)
    })

    it("Cancel button closes drawer", async () => {
      const ui = useUi()
      ui.isDrawerOpen.value = true

      const wrapper = mount(QuickAddForm)
      const btns = wrapper.findAllComponents({ name: "UiButton" })
      await btns[0]!.trigger("click")

      expect(ui.isDrawerOpen.value).toBe(false)
    })

    it("Enter key submits form when title filled", async () => {
      const ui = useUi()
      ui.isDrawerOpen.value = true
      const { events } = useEvents()

      const wrapper = mount(QuickAddForm)
      await wrapper.find("input[placeholder='Event title']").setValue("Dinner")
      await wrapper.find(".quick-add-form").trigger("keydown", { key: "Enter", shiftKey: false })
      await new Promise(r => setTimeout(r, 0))

      expect(events.value).toHaveLength(1)
    })

    it("Shift+Enter does not submit", async () => {
      const { events } = useEvents()
      const wrapper = mount(QuickAddForm)
      await wrapper.find("input[placeholder='Event title']").setValue("Test")
      await wrapper.find(".quick-add-form").trigger("keydown", { key: "Enter", shiftKey: true })
      expect(events.value).toHaveLength(0)
    })

    it("empty title does not submit on Enter", async () => {
      const { events } = useEvents()
      const wrapper = mount(QuickAddForm)
      await wrapper.find(".quick-add-form").trigger("keydown", { key: "Enter", shiftKey: false })
      expect(events.value).toHaveLength(0)
    })

    it("can clear all calendars", async () => {
      const { calendars } = useEvents()
      calendars.value = []
      expect(calendars.value).toHaveLength(0)
      mount(QuickAddForm)
    })
  })

  describe("Task form (tasks panel active)", () => {
    beforeEach(() => {
      const ui = useUi()
      ui.activePanel.value = "tasks"

      const { upsertList } = useTasks()
      upsertList({
        id: "list-default", householdId: "h-1", name: "Chores",
        color: "taupe", position: 0,
      })
    })

    it("renders task title input", () => {
      const wrapper = mount(QuickAddForm)
      expect(wrapper.find("input[placeholder='Task title']").exists()).toBe(true)
    })

    it("does not render list selector", () => {
      const wrapper = mount(QuickAddForm)
      expect(wrapper.find("select").exists()).toBe(false)
    })

    it("renders priority buttons", () => {
      const wrapper = mount(QuickAddForm)
      const priorityBtns = wrapper.findAll(".priority-btn")
      expect(priorityBtns).toHaveLength(3)
    })

    it("medium priority is active by default", () => {
      const wrapper = mount(QuickAddForm)
      const mediumBtn = wrapper.findAll(".priority-btn")[1]
      expect(mediumBtn!.classes()).toContain("active")
    })

    it("clicking high priority sets it active", async () => {
      const wrapper = mount(QuickAddForm)
      const btns = wrapper.findAll(".priority-btn")
      await btns[2]!.trigger("click")
      expect(btns[2]!.classes()).toContain("active")
      expect(btns[1]!.classes()).not.toContain("active")
    })

    it("renders due date input", () => {
      const wrapper = mount(QuickAddForm)
      expect(wrapper.find("input[type='date']").exists()).toBe(true)
    })

    it("renders description textarea", () => {
      const wrapper = mount(QuickAddForm)
      expect(wrapper.find("textarea").exists()).toBe(true)
    })

    it("renders Cancel and Create Task buttons", () => {
      const wrapper = mount(QuickAddForm)
      const btns = wrapper.findAllComponents({ name: "UiButton" })
      expect(btns[1]!.text()).toContain("Create Task")
    })

    it("Create Task is disabled when title is empty", () => {
      const wrapper = mount(QuickAddForm)
      const btns = wrapper.findAllComponents({ name: "UiButton" })
      expect(btns[1]!.props("disabled")).toBe(true)
    })

    it("creating a task adds to tasks store and closes drawer", async () => {
      const ui = useUi()
      ui.isDrawerOpen.value = true
      const { tasks } = useTasks()

      const wrapper = mount(QuickAddForm)
      await wrapper.find("input[placeholder='Task title']").setValue("Buy milk")
      const btns = wrapper.findAllComponents({ name: "UiButton" })
      await btns[1]!.trigger("click")
      await new Promise(r => setTimeout(r, 0))

      expect(tasks.value).toHaveLength(1)
      expect(tasks.value[0]!.title).toBe("Buy milk")
      expect(tasks.value[0]!.status).toBe("todo")
      expect(tasks.value[0]!.priority).toBe("medium")
      expect(ui.isDrawerOpen.value).toBe(false)
    })

    it("creating a task with high priority stores correctly", async () => {
      const ui = useUi()
      ui.isDrawerOpen.value = true
      const { tasks } = useTasks()

      const wrapper = mount(QuickAddForm)
      await wrapper.find("input[placeholder='Task title']").setValue("Urgent fix")
      await wrapper.findAll(".priority-btn")[2]!.trigger("click")
      const btns = wrapper.findAllComponents({ name: "UiButton" })
      await btns[1]!.trigger("click")
      await new Promise(r => setTimeout(r, 0))

      expect(tasks.value[0]!.priority).toBe("high")
    })

    it("creating task with due date sets it", async () => {
      const ui = useUi()
      ui.isDrawerOpen.value = true
      const { tasks } = useTasks()

      const wrapper = mount(QuickAddForm)
      await wrapper.find("input[placeholder='Task title']").setValue("Deadline task")
      await wrapper.find("input[type='date']").setValue("2026-06-01")
      const btns = wrapper.findAllComponents({ name: "UiButton" })
      await btns[1]!.trigger("click")
      await new Promise(r => setTimeout(r, 0))

      expect(tasks.value[0]!.startAt).toBeTruthy()
      expect(tasks.value[0]!.startAt).toContain("2026-06-01")
    })

    it("Enter key submits task form", async () => {
      const ui = useUi()
      ui.isDrawerOpen.value = true
      const { tasks } = useTasks()

      const wrapper = mount(QuickAddForm)
      await wrapper.find("input[placeholder='Task title']").setValue("Clean room")
      await wrapper.find(".quick-add-form").trigger("keydown", { key: "Enter", shiftKey: false })
      await new Promise(r => setTimeout(r, 0))

      expect(tasks.value).toHaveLength(1)
    })
  })

  describe("Context switching", () => {
    it("renders task form from tasks panel", () => {
      const ui = useUi()
      ui.activePanel.value = "tasks"

      const { upsertList } = useTasks()
      upsertList({
        id: "l1", householdId: "h-1", name: "Work",
        color: "forest", position: 0,
      })

      const wrapper = mount(QuickAddForm)
      expect(wrapper.find("input[placeholder='Task title']").exists()).toBe(true)
    })
  })

  describe("Validation", () => {
    beforeEach(() => {
      const ui = useUi()
      ui.activePanel.value = "calendar"
      const { upsertCalendar } = useEvents()
      upsertCalendar({
        id: "cal-val", householdId: "h-1", name: "Family",
        color: "sage", source: "internal", feedUrl: null,
        isVisible: true, createdBy: "u-1",
      })
    })

    it("Create Event is disabled with only whitespace title", async () => {
      const wrapper = mount(QuickAddForm)
      const input = wrapper.find("input[placeholder='Event title']")
      await input.setValue("   ")
      const btns = wrapper.findAllComponents({ name: "UiButton" })
      expect(btns[1]!.props("disabled")).toBe(true)
    })

    it("has description textarea with placeholder", () => {
      const wrapper = mount(QuickAddForm)
      const ta = wrapper.find("textarea")
      expect(ta.exists()).toBe(true)
      expect(ta.attributes("placeholder")).toBeTruthy()
    })

    it("date input accepts valid date format", async () => {
      const wrapper = mount(QuickAddForm)
      const dateInput = wrapper.find("input[type='date']")
      await dateInput.setValue("2026-12-25")
      expect((dateInput.element as HTMLInputElement).value).toBe("2026-12-25")
    })
  })
})
