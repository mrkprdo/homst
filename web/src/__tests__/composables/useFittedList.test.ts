import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { defineComponent, h, nextTick, ref } from "vue"
import { flushPromises, mount } from "@vue/test-utils"
import { useFittedList, type FittedEntry } from "@/composables/useFittedList"

interface Entry extends FittedEntry {
  id: string
}

const entries = ref<Entry[]>([])
const measureKey = ref(0)
let containerHeight = 0
let rowHeight = 40
let labelHeight = 20
const footerHeight = 16
let roCallback: (() => void) | null = null
let api: ReturnType<typeof useFittedList<Entry>>

const Harness = defineComponent({
  setup() {
    const container = ref<HTMLElement | null>(null)
    api = useFittedList({
      container,
      entries: () => entries.value,
      measureKey: () => measureKey.value,
    })
    return () => h(
      "div",
      { ref: container, class: "fit-root", style: "row-gap: 0px; padding: 0;" },
      [
        ...api.visible.value.map(entry => h("div", { key: entry.id, class: entry.kind })),
        api.hiddenCount.value > 0
          ? h("p", { class: "list-more" }, `+${api.hiddenCount.value} more`)
          : null,
      ],
    )
  },
})

const originalClientHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight")
const originalResizeObserver = globalThis.ResizeObserver
let rectSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  entries.value = []
  measureKey.value = 0
  containerHeight = 0
  rowHeight = 40
  labelHeight = 20

  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get(this: HTMLElement) {
      return this.classList?.contains("fit-root") ? containerHeight : 0
    },
  })

  globalThis.ResizeObserver = class {
    constructor(callback: () => void) { roCallback = callback }
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver

  rectSpy = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    let height = 0
    if (this.classList.contains("row") || this.classList.contains("task")) height = rowHeight
    else if (this.classList.contains("label")) height = labelHeight
    else if (this.classList.contains("list-more")) height = footerHeight
    return {
      height, width: 0, top: 0, left: 0, right: 0, bottom: 0, x: 0, y: 0,
      toJSON: () => ({}),
    } as DOMRect
  })
})

afterEach(() => {
  rectSpy.mockRestore()
  globalThis.ResizeObserver = originalResizeObserver
  if (originalClientHeight) {
    Object.defineProperty(HTMLElement.prototype, "clientHeight", originalClientHeight)
  }
})

function rows(count: number): Entry[] {
  return Array.from({ length: count }, (_, i) => ({ kind: "row", id: `row-${i}` }))
}

describe("useFittedList", () => {
  it("trims to the rows that fit, reserves a footer slot, and re-fits on resize", async () => {
    containerHeight = 140
    entries.value = rows(10)

    const wrapper = mount(Harness)
    await flushPromises()
    await nextTick()

    // 140px fits three rows once the measured "+N more" slot is reserved.
    expect(api.visible.value).toHaveLength(3)
    expect(api.hiddenCount.value).toBe(7)
    expect(wrapper.findAll(".row")).toHaveLength(3)
    expect(wrapper.find(".list-more").text()).toBe("+7 more")

    // A font-scale change clears the cached row heights and re-measures.
    measureKey.value++
    await flushPromises()
    await nextTick()
    expect(api.visible.value).toHaveLength(3)
    expect(api.hiddenCount.value).toBe(7)

    // Taller tile exposes more rows without scrolling.
    containerHeight = 300
    roCallback!()
    await flushPromises()
    await nextTick()
    expect(api.visible.value).toHaveLength(7)
    expect(api.hiddenCount.value).toBe(3)
    expect(wrapper.findAll(".row")).toHaveLength(7)

    // New rows of a known kind are trimmed without a re-measure.
    entries.value = rows(12)
    await flushPromises()
    expect(api.hiddenCount.value).toBe(5)

    // Even a tile too small for a footer keeps its first row visible.
    containerHeight = 50
    roCallback!()
    await flushPromises()
    await nextTick()
    expect(api.visible.value).toHaveLength(1)
    expect(api.hiddenCount.value).toBe(0)

    wrapper.unmount()
  })

  it("re-measures new row kinds and trims a trailing group label", async () => {
    containerHeight = 80
    labelHeight = 0 // first pass cannot measure the label yet
    entries.value = [
      { kind: "row", id: "r1" },
      { kind: "label", id: "l1" },
      { kind: "row", id: "r2" },
    ]

    const wrapper = mount(Harness)
    await flushPromises()
    await nextTick()

    // Unmeasurable kind falls back to showing every row.
    expect(api.visible.value).toHaveLength(3)

    labelHeight = 20
    roCallback!()
    await flushPromises()
    await nextTick()

    // row, label, row would end on a label; the label is dropped so it never hangs.
    expect(api.visible.value.map(entry => entry.id)).toEqual(["r1"])
    // Only the hidden row counts as "more" — the label is chrome.
    expect(api.hiddenCount.value).toBe(1)

    // Empty data resets the list instead of leaving a stale slice behind.
    entries.value = []
    await flushPromises()
    expect(api.visible.value).toHaveLength(0)
    expect(api.hiddenCount.value).toBe(0)

    wrapper.unmount()
  })
})
