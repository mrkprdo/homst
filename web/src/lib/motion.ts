import { animate as animeAnimate, stagger, createTimeline, spring } from 'animejs'

export { stagger, createTimeline }

const ANIMATIONS_ENABLED_KEY = 'homst-animations-enabled'

function getUserAnimationOverride(): boolean | null {
  try {
    const raw = window.localStorage.getItem(ANIMATIONS_ENABLED_KEY)
    if (raw === 'true') return true
    if (raw === 'false') return false
  } catch {}
  return null
}

function detectArmLinux(): boolean {
  if (typeof navigator === 'undefined') return false
  return /linux (armv7l|armv8l|aarch64)/.test(navigator.userAgent.toLowerCase())
}

function detectWeakDevice(): boolean {
  if (typeof navigator === 'undefined') return false

  const isVitest = typeof import.meta !== 'undefined' && (import.meta as any).env?.VITEST === true
  if (isVitest) return false

  const isArmLinux = detectArmLinux()
  const lowCores = navigator.hardwareConcurrency != null && navigator.hardwareConcurrency <= 4
  const lowMemory = (navigator as any).deviceMemory != null && (navigator as any).deviceMemory <= 4

  if (isArmLinux) return lowCores || lowMemory
  return lowCores && lowMemory
}

function detectPerformanceMode(): boolean {
  if (typeof window === 'undefined') return false

  if (typeof window.matchMedia === 'function') {
    try {
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return true
    } catch {}
  }

  try {
    if (new URLSearchParams(window.location.search).has('low-power')) return true
  } catch {}

  return detectWeakDevice()
}

function detectLowPower(): boolean {
  if (typeof window === 'undefined') return false

  const userOverride = getUserAnimationOverride()
  if (userOverride === true) return false
  if (userOverride === false) return true

  return detectPerformanceMode()
}

let lowPower = detectLowPower()
export let isLowPower = lowPower

let performanceMode = detectPerformanceMode()

function detectCheapCompositor(): boolean {
  if (typeof window === 'undefined') return false
  try {
    const params = new URLSearchParams(window.location.search)
    if (params.has('cheap-motion')) return true
    if (params.has('full-motion')) return false
  } catch {}
  return detectArmLinux() || detectWeakDevice()
}

let cheapCompositor = detectCheapCompositor()

export function isCheapCompositor(): boolean {
  return cheapCompositor
}

export function setCheapCompositor(enabled: boolean): void {
  cheapCompositor = enabled
  syncMotionClasses()
}

export function isPerformanceMode(): boolean {
  return performanceMode
}

export function setPerformanceMode(enabled: boolean): void {
  performanceMode = enabled
}

function syncMotionClasses(): void {
  if (typeof document === 'undefined') return
  document.documentElement.classList.toggle('low-power', lowPower)
  document.documentElement.classList.toggle('cheap-compositor', cheapCompositor)
  document.documentElement.classList.toggle('motion-on', !lowPower)
  ;(window as any).__homstMotion = {
    lowPower,
    cheapCompositor,
    performanceMode,
    armLinux: detectArmLinux(),
  }
}

export function setLowPower(enabled: boolean): void {
  lowPower = enabled
  isLowPower = enabled
  syncMotionClasses()
}

syncMotionClasses()

export function getAnimationEnabled(): boolean {
  return !isLowPower
}

export function canAnimateTransform(): boolean {
  if (typeof window === "undefined") return false
  if (getUserAnimationOverride() === false) return false
  try {
    if (typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return false
  } catch {}
  return true
}

export function setAnimationEnabled(enabled: boolean): void {
  try {
    window.localStorage.setItem(ANIMATIONS_ENABLED_KEY, String(enabled))
  } catch {}
  setLowPower(!enabled)
}

export const springs = {
  enter:   spring({ stiffness: 200, damping: 8 }),

  overlay: spring({ stiffness: 280, damping: 14 }),

  item:    spring({ stiffness: 240, damping: 9 }),

  pop:     spring({ stiffness: 400, damping: 10 }),

  press:   spring({ stiffness: 600, damping: 30 }),

  toggle:  spring({ stiffness: 350, damping: 9 }),

  swipe:   spring({ stiffness: 180, damping: 5 }),
}

export const ease = {
  out:     'outQuart',
  outFast: 'outExpo',
  in:      'inQuart',
  rubber:  'cubic-bezier(0.34, 1.56, 0.64, 1)',
}

export const dur = {
  fast:   120,
  base:   200,
  slow:   320,
}

const transformProps = new Set([
  'translateX', 'translateY', 'translateZ',
  'scale', 'scaleX', 'scaleY',
  'rotate', 'rotateX', 'rotateY', 'rotateZ',
  'skewX', 'skewY',
])

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
      if (key.startsWith('--')) style.setProperty(key, value)
      else (style as any)[key] = value
    }
  }
}

export function animate(...args: Parameters<typeof animeAnimate>): ReturnType<typeof animeAnimate> {
  if (!isLowPower && !cheapCompositor) {
    return animeAnimate(...args)
  }

  const [target, params] = args
  const raw = (params ?? {}) as any

  applyFinalState(target, raw)

  if (typeof raw.onComplete === 'function') {
    const cb = raw.onComplete
    const schedule =
      typeof requestAnimationFrame === 'function'
        ? requestAnimationFrame
        : (fn: FrameRequestCallback) => setTimeout(fn, 0)
    schedule(cb)
  }

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
