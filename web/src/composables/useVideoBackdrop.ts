import { onBeforeUnmount, ref, watch, type Ref } from "vue"
import { isPerformanceMode } from "@/lib/motion"

export const BACKDROP_INTERVAL_MS = 250
export const BACKDROP_MAX_DIMENSION = 320
export const LOW_POWER_BACKDROP_INTERVAL_MS = 15 * 60 * 1000
const LOW_POWER_WARMUP_MS = 500

export function useVideoBackdrop(
  video: Ref<HTMLVideoElement | null>,
  active: Ref<boolean>,
  intervalMs = BACKDROP_INTERVAL_MS,
  rotation: Ref<number> = ref(0),
) {
  const canvas = ref<HTMLCanvasElement | null>(null)
  let timer: ReturnType<typeof setInterval> | null = null

  function stop() {
    if (timer !== null) {
      clearInterval(timer)
      timer = null
    }
  }

  function draw(): boolean {
    const el = video.value
    const target = canvas.value
    if (!el || !target || !active.value || el.readyState < 2 || !el.videoWidth || !el.videoHeight) {
      return false
    }

    const scale = Math.min(1, BACKDROP_MAX_DIMENSION / Math.max(el.videoWidth, el.videoHeight))
    const frameWidth = Math.max(1, Math.round(el.videoWidth * scale))
    const frameHeight = Math.max(1, Math.round(el.videoHeight * scale))
    const angle = ((Math.round(rotation.value / 90) * 90) % 360 + 360) % 360
    const quarterTurn = angle === 90 || angle === 270
    const width = quarterTurn ? frameHeight : frameWidth
    const height = quarterTurn ? frameWidth : frameHeight
    if (target.width !== width) target.width = width
    if (target.height !== height) target.height = height

    const context = target.getContext("2d")
    if (!context) return false
    if (angle === 0) {
      context.drawImage(el, 0, 0, frameWidth, frameHeight)
    } else {
      context.save()
      context.translate(width / 2, height / 2)
      context.rotate((angle * Math.PI) / 180)
      context.drawImage(el, -frameWidth / 2, -frameHeight / 2, frameWidth, frameHeight)
      context.restore()
    }
    return true
  }

  function start() {
    stop()
    if (!active.value) return

    if (!isPerformanceMode()) {
      draw()
      timer = setInterval(draw, intervalMs)
      return
    }

    const scheduleSlowRefresh = () => {
      timer = setInterval(draw, LOW_POWER_BACKDROP_INTERVAL_MS)
    }

    if (draw()) {
      scheduleSlowRefresh()
      return
    }

    timer = setInterval(() => {
      if (!draw()) return
      stop()
      scheduleSlowRefresh()
    }, LOW_POWER_WARMUP_MS)
  }

  watch([video, canvas, active, rotation], start, { immediate: true })
  onBeforeUnmount(stop)

  return { canvas, draw, start, stop }
}
