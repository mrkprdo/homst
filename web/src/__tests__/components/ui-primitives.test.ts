import { describe, it, expect, beforeEach } from "vitest"
import { nextTick } from "vue"
import { mount } from "@vue/test-utils"
import { setLowPower } from "@/lib/motion"
import { useSettings } from "@/composables/useSettings"
import UiAvatar from "@/components/ui/UiAvatar.vue"
import UiBadge from "@/components/ui/UiBadge.vue"
import UiButton from "@/components/ui/UiButton.vue"
import UiCard from "@/components/ui/UiCard.vue"
import UiEmptyState from "@/components/ui/UiEmptyState.vue"
import UiField from "@/components/ui/UiField.vue"
import UiInput from "@/components/ui/UiInput.vue"
import UiSelect from "@/components/ui/UiSelect.vue"
import UiTextarea from "@/components/ui/UiTextarea.vue"
import PageHeader from "@/components/ui/PageHeader.vue"
import EventChip from "@/components/ui/EventChip.vue"
import TaskCard from "@/components/ui/TaskCard.vue"
import UiSegmentedControl from "@/components/ui/UiSegmentedControl.vue"

describe("UI primitives", () => {
  beforeEach(() => {
    setLowPower(true)
  })

  it("UiAvatar renders size and color variants", () => {
    const w1 = mount(UiAvatar, { slots: { default: "AB" } })
    expect(w1.classes()).toContain("ui-avatar--md")
    expect(w1.classes()).toContain("ui-avatar--sage")
    expect(w1.text()).toBe("AB")

    const w2 = mount(UiAvatar, { props: { size: "lg", color: "plum" } })
    expect(w2.classes()).toContain("ui-avatar--lg")
    expect(w2.classes()).toContain("ui-avatar--plum")
  })

  it("UiBadge renders variants", () => {
    const w1 = mount(UiBadge, { slots: { default: "3" } })
    expect(w1.classes()).toContain("ui-badge--neutral")

    const w2 = mount(UiBadge, { props: { variant: "danger" }, slots: { default: "!" } })
    expect(w2.classes()).toContain("ui-badge--danger")
  })

  it("UiButton handles variants, sizes, disabled, and pointer animations", async () => {
    const w = mount(UiButton, { props: { variant: "secondary", size: "sm" }, slots: { default: "Go" } })
    expect(w.classes()).toContain("ui-btn--secondary")
    expect(w.classes()).toContain("ui-btn--sm")
    await w.trigger("pointerdown")
    await w.trigger("pointerup")
    await w.trigger("pointerleave")

    const wDisabled = mount(UiButton, { props: { disabled: true, type: "submit" } })
    await wDisabled.trigger("pointerdown")
    expect(wDisabled.attributes("type")).toBe("submit")
  })

  it("UiCard toggles padded and accent classes", () => {
    const w1 = mount(UiCard, { props: { padding: true }, slots: { default: "body" } })
    expect(w1.classes()).toContain("ui-card--padded")
    expect(w1.classes()).not.toContain("ui-card--accent")

    const w2 = mount(UiCard, { props: { padding: false, accent: true } })
    expect(w2.classes()).not.toContain("ui-card--padded")
    expect(w2.classes()).toContain("ui-card--accent")
  })

  it("UiEmptyState renders icon slot, message, and default slot", () => {
    const w = mount(UiEmptyState, {
      props: { message: "Nothing here" },
      slots: { icon: "<i>ic</i>", default: "<button>Add</button>" },
    })
    expect(w.text()).toContain("Nothing here")
    expect(w.text()).toContain("Add")
  })

  it("UiField renders label and grow modifier", () => {
    const w1 = mount(UiField, { props: { label: "Name", grow: true }, slots: { default: "<input />" } })
    expect(w1.classes()).toContain("ui-field--grow")
    expect(w1.find(".ui-field__label").text()).toBe("Name")

    const w2 = mount(UiField)
    expect(w2.find(".ui-field__label").exists()).toBe(false)
  })

  it("UiInput, UiSelect, UiTextarea emit update:modelValue", async () => {
    const inp = mount(UiInput, { props: { modelValue: "a", placeholder: "p" } })
    await inp.find("input").setValue("hello")
    expect(inp.emitted("update:modelValue")?.[0]).toEqual(["hello"])

    const sel = mount(UiSelect, {
      props: { modelValue: "x" },
      slots: { default: '<option value="x">X</option><option value="y">Y</option>' },
    })
    await sel.find("select").setValue("y")
    expect(sel.emitted("update:modelValue")?.[0]).toEqual(["y"])

    const ta = mount(UiTextarea, { props: { modelValue: "init", rows: 5 } })
    expect(ta.find("textarea").attributes("rows")).toBe("5")
    await ta.find("textarea").setValue("updated")
    expect(ta.emitted("update:modelValue")?.[0]).toEqual(["updated"])
  })

  it("PageHeader renders title and optional actions slot", () => {
    const w1 = mount(PageHeader, { props: { title: "Tasks" } })
    expect(w1.text()).toBe("Tasks")
    expect(w1.find(".page-header__actions").exists()).toBe(false)

    const w2 = mount(PageHeader, { props: { title: "Tasks" }, slots: { actions: "<button>+</button>" } })
    expect(w2.find(".page-header__actions").exists()).toBe(true)
  })

  it("EventChip handles hex without #, pointer events, click and enter key", async () => {
    const w = mount(EventChip, { props: { title: "Meet", time: "09:00", color: "fcd0a1" } })
    expect(w.find(".event-chip__time").text()).toBe("09:00")
    await w.trigger("pointerdown")
    await w.trigger("pointerup")
    await w.trigger("click")
    await w.trigger("keydown.enter")
    expect(w.emitted("click")).toHaveLength(2)

    const wAllDay = mount(EventChip, { props: { title: "Holiday", time: "09:00", allDay: true } })
    expect(wAllDay.find(".event-chip__time").exists()).toBe(false)
  })

  it("TaskCard renders priorities, dueDate, assignee, and pointer handlers when done vs active", async () => {
    const w = mount(TaskCard, {
      props: { title: "Clean", priority: "high", dueDate: "May 5", assigneeInitials: "JD", color: "peach" },
    })
    expect(w.text()).toContain("high")
    expect(w.text()).toContain("due May 5")
    expect(w.text()).toContain("JD")
    await w.trigger("pointerdown")
    await w.trigger("pointerup")

    const wMed = mount(TaskCard, { props: { title: "M", priority: "medium", done: true } })
    await wMed.trigger("pointerdown") // early return when done
    const wLow = mount(TaskCard, { props: { title: "L", priority: "low" } })
    expect(wLow.text()).toContain("low")
  })

  it("UiSegmentedControl selects options, animates on modelValue change and fontSize change", async () => {
    const opts = [
      { value: "a", label: "Alpha" },
      { value: "b", label: "Beta" },
    ]
    const w = mount(UiSegmentedControl, { props: { modelValue: "a", options: opts } })
    await nextTick()
    await w.findAll("button")[1]!.trigger("click")
    expect(w.emitted("update:modelValue")?.[0]).toEqual(["b"])

    await w.setProps({ modelValue: "b" })
    await nextTick()

    const settings = useSettings()
    settings.updateFontSize("small")
    await nextTick()
  })
})
