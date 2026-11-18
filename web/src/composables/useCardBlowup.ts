import { nextTick, onUnmounted, ref } from "vue"
import { animate, canAnimateTransform, ease, isLowPower, springs } from "@/lib/motion"

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",")

const OPEN_DURATION = 340
const CLOSE_DURATION = 220
const ENTER_EASING = "cubic-bezier(0.22, 1, 0.36, 1)"
const EXIT_EASING = "cubic-bezier(0.4, 0, 1, 1)"

interface Flip {
  x: number
  y: number
  scaleX: number
  scaleY: number
}

function transformOf(flip: Flip): string {
  return `translate(${flip.x}px, ${flip.y}px) scale(${flip.scaleX}, ${flip.scaleY})`
}

/**
 * Shared-element "blow up" view for dashboard cards.
 *
 * The real card element is moved into a fixed overlay rather than cloned, so
 * live content (camera video, photo slideshow, ticking clock, inner controls)
 * keeps working while it is expanded. A FLIP transform lifts it out of the
 * grid and settles it into the centre of the screen, then plays in reverse on
 * close before the node is put back where it came from.
 */
export function useCardBlowup() {
  const active = ref(false)
  const ready = ref(false)
  const label = ref("Card")
  /** The element the moved card is appended to. */
  const stageEl = ref<HTMLElement | null>(null)
  const closeEl = ref<HTMLElement | null>(null)

  let sourceEl: HTMLElement | null = null
  let sourceParent: Node | null = null
  let sourceNext: ChildNode | null = null
  let startRect: DOMRect | null = null
  let lastFocused: HTMLElement | null = null
  let closing = false
  let motionHandle: { cancel: () => void } | null = null
  let flipGeneration = 0

  function focusables(): HTMLElement[] {
    const items: HTMLElement[] = []
    if (closeEl.value) items.push(closeEl.value)
    const stage = stageEl.value
    if (stage) items.push(...Array.from(stage.querySelectorAll<HTMLElement>(FOCUSABLE)))
    return items
  }

  function onKeydown(e: KeyboardEvent) {
    if (!active.value) return

    if (e.key === "Escape") {
      e.preventDefault()
      e.stopPropagation()
      close()
      return
    }

    if (e.key !== "Tab") return

    const items = focusables()
    const first = items[0]
    const last = items[items.length - 1]
    if (!first || !last) return

    const focused = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const inside = !!focused && (focused === closeEl.value || !!stageEl.value?.contains(focused))

    if (!inside) {
      e.preventDefault()
      ;(e.shiftKey ? last : first).focus()
      return
    }

    // Keep Tab cycling through the expanded card and its close button.
    if (e.shiftKey && focused === first) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && focused === last) {
      e.preventDefault()
      first.focus()
    }
  }

  /**
   * Animate a transform-only FLIP between two states.
   *
   * Capable clients get the rubbery spring. Weak displays skip the full motion
   * budget but still get one cheap compositor transform, so the card visibly
   * grows instead of snapping; explicit "animations off" and reduced-motion
   * preferences jump straight to the end.
   */
  function runFlip(
    el: HTMLElement,
    from: Flip,
    to: Flip,
    opts: { spring?: boolean; duration: number; easing: string; onComplete: () => void },
  ) {
    const generation = ++flipGeneration
    motionHandle?.cancel()
    motionHandle = null

    const complete = () => {
      if (generation !== flipGeneration) return
      el.style.transform = ""
      el.style.transformOrigin = ""
      opts.onComplete()
    }

    const params: Record<string, unknown> = {
      translateX: [from.x, to.x],
      translateY: [from.y, to.y],
      scaleX: [from.scaleX, to.scaleX],
      scaleY: [from.scaleY, to.scaleY],
      onComplete: complete,
    }
    if (opts.spring) params.ease = springs.overlay
    else {
      params.duration = opts.duration
      params.ease = ease.in
    }

    el.style.transformOrigin = "0 0"

    if (!isLowPower) {
      motionHandle = animate(el, params as any)
      return
    }

    if (canAnimateTransform() && typeof el.animate === "function") {
      const animation = el.animate(
        [{ transform: transformOf(from) }, { transform: transformOf(to) }],
        { duration: opts.duration, easing: opts.easing, fill: "both" },
      )
      motionHandle = animation
      const finish = () => {
        if (generation !== flipGeneration) return
        animation.cancel()
        complete()
      }
      animation.finished.then(finish, finish)
      return
    }

    el.style.transform = transformOf(to)
    complete()
  }

  /** Put the card back and drop every trace of the overlay. */
  function restore() {
    flipGeneration++
    motionHandle?.cancel()
    motionHandle = null

    const el = sourceEl
    if (el) {
      el.style.transform = ""
      el.style.transformOrigin = ""
      if (sourceParent) {
        // A null anchor appends, which covers the case where the original
        // sibling was replaced while the card was expanded.
        const anchor = sourceNext && sourceNext.parentNode === sourceParent ? sourceNext : null
        sourceParent.insertBefore(el, anchor)
      }
    }

    document.removeEventListener("keydown", onKeydown, true)
    lastFocused?.focus?.()
    active.value = false
    ready.value = false
    closing = false
    sourceEl = null
    sourceParent = null
    sourceNext = null
    startRect = null
    lastFocused = null
  }

  async function open(el: HTMLElement, name = "Card") {
    if (active.value || closing) return

    active.value = true
    ready.value = false
    label.value = name
    sourceEl = el
    sourceParent = el.parentNode
    sourceNext = el.nextSibling
    lastFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null
    startRect = el.getBoundingClientRect()

    await nextTick()
    const stage = stageEl.value
    if (!stage) return restore()

    stage.appendChild(el)
    const endRect = stage.getBoundingClientRect()
    const from = startRect
    const hasRect = !!from && from.width > 0 && from.height > 0 && endRect.width > 0 && endRect.height > 0

    const translateX = hasRect ? from.left - endRect.left : 0
    const translateY = hasRect ? from.top - endRect.top : 0
    const scaleX = hasRect ? from.width / endRect.width : 1
    const scaleY = hasRect ? from.height / endRect.height : 1

    runFlip(
      el,
      { x: translateX, y: translateY, scaleX, scaleY },
      { x: 0, y: 0, scaleX: 1, scaleY: 1 },
      {
        spring: true,
        duration: OPEN_DURATION,
        easing: ENTER_EASING,
        onComplete: () => {},
      },
    )

    ready.value = true
    document.addEventListener("keydown", onKeydown, true)
    closeEl.value?.focus()
  }

  function close() {
    if (!active.value || closing) return
    closing = true
    ready.value = false

    const el = sourceEl
    const stage = stageEl.value
    if (!el || !stage) return restore()

    const from = startRect
    const endRect = stage.getBoundingClientRect()
    const hasRect = !!from && from.width > 0 && from.height > 0 && endRect.width > 0 && endRect.height > 0

    const translateX = hasRect ? from.left - endRect.left : 0
    const translateY = hasRect ? from.top - endRect.top : 0
    const scaleX = hasRect ? from.width / endRect.width : 1
    const scaleY = hasRect ? from.height / endRect.height : 1

    runFlip(
      el,
      { x: 0, y: 0, scaleX: 1, scaleY: 1 },
      { x: translateX, y: translateY, scaleX, scaleY },
      {
        duration: hasRect ? CLOSE_DURATION : 120,
        easing: EXIT_EASING,
        onComplete: restore,
      },
    )
  }

  onUnmounted(() => {
    flipGeneration++
    motionHandle?.cancel()
    motionHandle = null
    document.removeEventListener("keydown", onKeydown, true)
    sourceEl = null
    sourceParent = null
    sourceNext = null
    startRect = null
    lastFocused = null
    closing = false
  })

  return { active, ready, label, stageEl, closeEl, open, close }
}
