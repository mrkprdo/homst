import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch, type Ref } from "vue"

export interface FittedEntry {
  /** Rows are measured per kind, so labels and items can differ in height. */
  kind: string
}

interface Options<T extends FittedEntry> {
  /** The element that owns the available height (usually a flex: 1 list). */
  container: Ref<HTMLElement | null>
  entries: () => T[]
  /** Re-measure when this value changes (e.g. the household font-size setting). */
  measureKey?: () => unknown
}

const FALLBACK_ROW_HEIGHT = 32

/**
 * Fits a vertical list to its container instead of letting it scroll or clip.
 *
 * Rows are measured once with every entry rendered, then the list is trimmed
 * to the entries that fit. A "+N more" footer is reserved a slot whenever the
 * data does not fit, so a dashboard tile always shows a clean, complete slice.
 */
export function useFittedList<T extends FittedEntry>(options: Options<T>) {
  const visibleCount = ref(Number.POSITIVE_INFINITY)
  const measuring = ref(false)
  const showMore = ref(false)
  const heights = new Map<string, number>()
  let gap = 0
  let padY = 0
  let ro: ResizeObserver | null = null
  let measureQueued = false

  const all = computed(options.entries)

  const visible = computed(() => {
    const entries = all.value
    if (measuring.value || !Number.isFinite(visibleCount.value)) return entries
    return entries.slice(0, visibleCount.value)
  })

  const hiddenCount = computed(() => {
    if (!showMore.value || !Number.isFinite(visibleCount.value) || visibleCount.value <= 0) return 0
    // Group labels are chrome, not data — only real entries count as "more".
    return all.value.slice(visibleCount.value).filter(entry => entry.kind !== "label").length
  })

  function hasHeights(entries: T[]) {
    return entries.every(entry => heights.has(entry.kind))
  }

  async function measure() {
    if (measuring.value) {
      measureQueued = true
      return
    }
    const el = options.container.value
    const entries = all.value
    if (!el || !entries.length) {
      visibleCount.value = Number.POSITIVE_INFINITY
      return
    }

    // Render every entry for one frame so natural row heights can be read.
    measuring.value = true
    await nextTick()

    const children = Array.from(el.children) as HTMLElement[]
    // Re-read after the render tick: data may have changed while measuring.
    const measuredEntries = all.value
    const styles = getComputedStyle(el)
    gap = Number.parseFloat(styles.rowGap) || 0
    padY = (Number.parseFloat(styles.paddingTop) || 0) + (Number.parseFloat(styles.paddingBottom) || 0)
    children.forEach((child, index) => {
      const entry = measuredEntries[index]
      if (!entry) return
      const height = child.getBoundingClientRect().height || child.offsetHeight
      if (height > 0) heights.set(entry.kind, height)
    })

    const more = el.querySelector<HTMLElement>(".list-more")
    if (more) {
      const height = more.getBoundingClientRect().height || more.offsetHeight
      if (height > 0) heights.set("__more", height)
    }

    measuring.value = false
    await nextTick()
    fit()

    if (measureQueued) {
      measureQueued = false
      void measure()
    }
  }

  function fit() {
    const el = options.container.value
    const entries = all.value
    if (!el || el.clientHeight <= 0 || !entries.length) {
      // Unmeasured (SSR, jsdom, collapsed grid) — show everything rather than
      // hiding data behind a zero-height container.
      visibleCount.value = Number.POSITIVE_INFINITY
      return
    }

    const available = Math.max(0, el.clientHeight - padY)

    function heightOf(index: number): number {
      return heights.get(entries[index].kind) ?? 0
    }

    function usedFor(count: number): number {
      let used = 0
      for (let i = 0; i < count; i++) used += (i > 0 ? gap : 0) + heightOf(i)
      return used
    }

    let count = 0
    let used = 0
    for (let i = 0; i < entries.length; i++) {
      const height = heightOf(i)
      if (height <= 0) {
        // A new row kind arrived; wait for the measuring pass.
        visibleCount.value = Number.POSITIVE_INFINITY
        return
      }
      const next = used + (count > 0 ? gap : 0) + height
      if (next > available) break
      used = next
      count++
    }

    if (count < entries.length) {
      const rowsThatFit = count
      // Reserve a slot for the "+N more" footer so it fits too.
      const moreHeight = heights.get("__more")
        ?? Math.ceil((heights.get("row") ?? heights.get("task") ?? FALLBACK_ROW_HEIGHT) * 0.7)
      const budget = Math.max(0, available - gap - moreHeight)
      while (count > 0 && usedFor(count) > budget) count--
      // Never leave a group label hanging at the bottom with no rows below it.
      while (count > 0 && entries[count - 1].kind === "label") count--

      if (count === 0 && rowsThatFit > 0) {
        // Too small even for one row plus the footer — show the rows instead.
        visibleCount.value = rowsThatFit
        showMore.value = false
        return
      }
    }

    showMore.value = count < entries.length
    visibleCount.value = count
  }

  function sync() {
    const entries = all.value
    if (!entries.length) {
      visibleCount.value = Number.POSITIVE_INFINITY
      return
    }
    if (!hasHeights(entries)) {
      void measure()
      return
    }
    fit()
  }

  function observe(el: HTMLElement | null) {
    if (typeof ResizeObserver === "undefined") return
    if (!ro) {
      // Row heights can change when a container-query tier kicks in on resize,
      // so re-measure instead of reusing stale cached heights.
      ro = new ResizeObserver(() => void measure())
    }
    ro.disconnect()
    if (el) ro.observe(el)
  }

  watch(options.container, el => {
    observe(el)
    void measure()
  }, { flush: "post" })

  watch(
    () => all.value.map(entry => entry.kind).join("|"),
    () => sync(),
    { flush: "post" },
  )

  if (options.measureKey) {
    watch(options.measureKey, () => {
      heights.clear()
      void measure()
    }, { flush: "post" })
  }

  onMounted(() => {
    observe(options.container.value)
    void measure()
  })

  onBeforeUnmount(() => {
    ro?.disconnect()
    ro = null
  })

  return { visible, hiddenCount }
}
