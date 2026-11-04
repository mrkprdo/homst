import { onBeforeUnmount, ref, watch, type Ref } from "vue"
import { isLowPower } from "@/lib/motion"

/** Blurred backdrops only need a few frames per second to look smooth. */
export const BACKDROP_INTERVAL_MS = 250
export const BACKDROP_MAX_DIMENSION = 320
/** Low-power clients still get the effect, but from a nearly static frame. */
export const LOW_POWER_BACKDROP_INTERVAL_MS = 15 * 60 * 1000
const LOW_POWER_WARMUP_MS = 500

/**
 * Keep a small canvas in sync with a playing video. CSS stretches it with
 * `object-fit: cover` and blurs it, so it fills the letterbox area without
 * black bars and without decoding the stream a second time.
 *
 * Low-power clients (e.g. Raspberry Pi displays) copy a frame immediately and
 * then refresh it only every 15 minutes. Continuous canvas copies compete with
 * video decode there and show up as dropped frames.
 */
export function useVideoBackdrop(
  video: Ref<HTMLVideoElement | null>,
  active: Ref<boolean>,
  intervalMs = BACKDROP_INTERVAL_MS,
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
    const width = Math.max(1, Math.round(el.videoWidth * scale))
    const height = Math.max(1, Math.round(el.videoHeight * scale))
    if (target.width !== width) target.width = width
    if (target.height !== height) target.height = height

    const context = target.getContext("2d")
    if (!context) return false
    context.drawImage(el, 0, 0, width, height)
    return true
  }

  function start() {
    stop()
    if (!active.value) return

    if (!isLowPower) {
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

    // The video may not have a frame yet; keep trying cheaply until it does,
    // then settle into the 15-minute cadence.
    timer = setInterval(() => {
      if (!draw()) return
      stop()
      scheduleSlowRefresh()
    }, LOW_POWER_WARMUP_MS)
  }

  watch([video, canvas, active], start, { immediate: true })
  onBeforeUnmount(stop)

  return { canvas, draw, start, stop }
}
