import { animate as animeAnimate, stagger, createTimeline, spring } from 'animejs'

export { stagger, createTimeline }

// ═══════════════════════════════════════════════════════════════
// Low-power client detection (e.g. Raspberry Pi display)
// ═══════════════════════════════════════════════════════════════

const ANIMATIONS_ENABLED_KEY = 'homst-animations-enabled'

function getUserAnimationOverride(): boolean | null {
  try {
    const raw = window.localStorage.getItem(ANIMATIONS_ENABLED_KEY)
    if (raw === 'true') return true
    if (raw === 'false') return false
  } catch {}
  return null
}

function detectLowPower(): boolean {
  if (typeof window === 'undefined') return false

  // An explicit choice in the settings panel beats the system preference.
  const userOverride = getUserAnimationOverride()
  if (userOverride === true) return false
  if (userOverride === false) return true

  // Respect the system reduced-motion preference when the user hasn't chosen.
  if (typeof window.matchMedia === 'function') {
    try {
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return true
    } catch {}
  }

  // Manual override for debugging or kiosk configuration
  try {
    if (new URLSearchParams(window.location.search).has('low-power')) return true
  } catch {}

  // Avoid flagging Vitest test runners
  const isVitest = typeof import.meta !== 'undefined' && (import.meta as any).env?.VITEST === true
  if (isVitest) return false

  const ua = navigator.userAgent.toLowerCase()
  const isArmLinux = /linux (armv7l|armv8l|aarch64)/.test(ua)
  const lowCores = navigator.hardwareConcurrency != null && navigator.hardwareConcurrency <= 4
  const lowMemory = (navigator as any).deviceMemory != null && (navigator as any).deviceMemory <= 2

  // Pi / low-end ARM display boards typically report ARM Linux + limited resources
  return isArmLinux && (lowCores || lowMemory)
}

let lowPower = detectLowPower()
export let isLowPower = lowPower

function syncMotionClasses(): void {
  if (typeof document === 'undefined') return
  document.documentElement.classList.toggle('low-power', lowPower)
  // Lets the token stylesheet keep durations when the user explicitly opts in
  // despite `prefers-reduced-motion: reduce`.
  document.documentElement.classList.toggle('motion-on', !lowPower)
}

/** Toggle low-power mode at runtime (useful for tests / debug). */
export function setLowPower(enabled: boolean): void {
  lowPower = enabled
  isLowPower = enabled
  syncMotionClasses()
}

syncMotionClasses()

/** Read whether animations are currently enabled. */
export function getAnimationEnabled(): boolean {
  return !isLowPower
}

/** Persist user animation preference and apply it immediately. */
export function setAnimationEnabled(enabled: boolean): void {
  try {
    window.localStorage.setItem(ANIMATIONS_ENABLED_KEY, String(enabled))
  } catch {}
  setLowPower(!enabled)
}

// ═══════════════════════════════════════════════════════════════
// Rubbery tactile springs — underdamped so they overshoot and wobble back.
// Damping ratio = damping / (2 * sqrt(stiffness)); ratio < 1 = wobble.
// ═══════════════════════════════════════════════════════════════

export const springs = {
  // ── Entries: blocks, cards — slow-wind rubbery bounce (ratio ≈ 0.28)
  enter:   spring({ stiffness: 200, damping: 8 }),

  // ── Drawer/overlay — fast, one visible bounce at the end (ratio ≈ 0.42)
  overlay: spring({ stiffness: 280, damping: 14 }),

  // ── Staggered list items — snappy entry with one wobble (ratio ≈ 0.29)
  item:    spring({ stiffness: 240, damping: 9 }),

  // ── Button/pop release — elastic rubberband snap-back (ratio ≈ 0.25)
  pop:     spring({ stiffness: 400, damping: 10 }),

  // ── Press down (before release) — stiff, heavy resistance (ratio ≈ 0.61)
  press:   spring({ stiffness: 600, damping: 30 }),

  // ── Toggle switch knob — overshoots past target then settles (ratio ≈ 0.24)
  toggle:  spring({ stiffness: 350, damping: 9 }),

  // ── Drag/swipe release — heavy mass, long wobble tail (ratio ≈ 0.18)
  swipe:   spring({ stiffness: 180, damping: 5 }),
}

export const ease = {
  out:     'outQuart',
  outFast: 'outExpo',
  in:      'inQuart',
  // CSS cubic-bezier for rubbery release (overshoots ~8% then settles)
  rubber:  'cubic-bezier(0.34, 1.56, 0.64, 1)',
}

export const dur = {
  fast:   120,
  base:   200,
  slow:   320,
}

// ═══════════════════════════════════════════════════════════════
// animate() wrapper: skips to final state on low-power clients.
// This short-circuits expensive spring physics and paint-bound
// transitions on devices like Raspberry Pi displays.
// ═══════════════════════════════════════════════════════════════

const transformProps = new Set([
  'translateX', 'translateY', 'translateZ',
  'scale', 'scaleX', 'scaleY',
  'rotate', 'rotateX', 'rotateY', 'rotateZ',
  'skewX', 'skewY',
])

// Anime.js treats bare numbers as px (translate) or deg (rotate/skew), but CSS
// needs an explicit unit. Without these, a numeric transform such as
// translateX(109.14) is rejected by the browser and the element never moves.
const transformUnits: Record<string, string> = {
  translateX: 'px', translateY: 'px', translateZ: 'px',
  rotate: 'deg', rotateX: 'deg', rotateY: 'deg', rotateZ: 'deg',
  skewX: 'deg', skewY: 'deg',
}

function formatTransformValue(key: string, value: unknown): string {
  const unit = transformUnits[key]
  if (unit) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return `${value}${unit}`
    }
    if (typeof value === 'string' && /^-?(?:\d+\.?\d*|\.\d+)$/.test(value.trim())) {
      return `${value.trim()}${unit}`
    }
  }
  return String(value)
}

const reservedProps = new Set([
  'duration', 'delay', 'ease', 'onComplete', 'onBegin',
  'onUpdate', 'onLoop', 'onPause', 'autoplay', 'loop',
  'direction', 'stagger', 'alternate', 'round',
])

function getFinalValue(value: unknown): unknown {
  return Array.isArray(value) ? value[value.length - 1] : value
}

function getTargets(target: unknown): Element[] {
  if (!target) return []
  if (target instanceof Element) return [target]
  if (Array.isArray(target)) return target.filter((el): el is Element => el instanceof Element)
  if (target instanceof NodeList || target instanceof HTMLCollection) {
    return Array.from(target).filter((el): el is Element => el instanceof Element)
  }
  if (typeof target === 'string' && typeof document !== 'undefined') {
    return Array.from(document.querySelectorAll(target))
  }
  return []
}

function applyFinalState(target: unknown, params: any): void {
  const targets = getTargets(target)
  if (!targets.length || !params) return

  const transforms: string[] = []
  const otherStyles: Record<string, string> = {}

  for (const key of Object.keys(params)) {
    if (reservedProps.has(key)) continue
    const finalValue = getFinalValue(params[key])
    if (finalValue === undefined || finalValue === null) continue
    if (transformProps.has(key)) {
      transforms.push(`${key}(${formatTransformValue(key, finalValue)})`)
    } else {
      otherStyles[key] = String(finalValue)
    }
  }

  for (const el of targets) {
    const style = (el as HTMLElement).style
    if (transforms.length) {
      style.transform = transforms.join(' ')
    }
    for (const [key, value] of Object.entries(otherStyles)) {
      ;(style as any)[key] = value
    }
  }
}

export function animate(...args: Parameters<typeof animeAnimate>): ReturnType<typeof animeAnimate> {
  if (!isLowPower) {
    return animeAnimate(...args)
  }

  const [target, params] = args
  const raw = (params ?? {}) as any

  applyFinalState(target, raw)

  if (typeof raw.onComplete === 'function') {
    // Defer completion by one frame. Calling Vue Transition done() callbacks
    // synchronously (especially with mode="out-in") can leave Vue in a state
    // where it tries to access the leaving element's parent before the next
    // element has been anchored, causing "Cannot read properties of null".
    const cb = raw.onComplete
    const schedule =
      typeof requestAnimationFrame === 'function'
        ? requestAnimationFrame
        : (fn: FrameRequestCallback) => setTimeout(fn, 0)
    schedule(cb)
  }

  // Minimal stub matching the methods callers might chain.
  const stub = {
    complete: () => stub,
    cancel: () => stub,
    revert: () => stub,
    pause: () => stub,
    play: () => stub,
    seek: () => stub,
  } as unknown as ReturnType<typeof animeAnimate>

  return stub
}
