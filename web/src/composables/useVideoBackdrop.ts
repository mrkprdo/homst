import { onBeforeUnmount, ref, watch, type Ref } from "vue"

/** Blurred backdrops only need a few frames per second to look smooth. */
export const BACKDROP_INTERVAL_MS = 250
export const BACKDROP_MAX_DIMENSION = 320

/**
 * Keep a small canvas in sync with a playing video. CSS stretches it with
 * `object-fit: cover` and blurs it, so it fills the letterbox area without
 * black bars and without decoding the stream a second time.
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

  function draw() {
    const el = video.value
    const target = canvas.value
    if (!el || !target || !active.value || el.readyState < 2 || !el.videoWidth || !el.videoHeight) {
      return
    }

    const scale = Math.min(1, BACKDROP_MAX_DIMENSION / Math.max(el.videoWidth, el.videoHeight))
    const width = Math.max(1, Math.round(el.videoWidth * scale))
    const height = Math.max(1, Math.round(el.videoHeight * scale))
    if (target.width !== width) target.width = width
    if (target.height !== height) target.height = height

    const context = target.getContext("2d")
    if (!context) return
    context.drawImage(el, 0, 0, width, height)
  }

  function start() {
    stop()
    if (!active.value) return
    draw()
    timer = setInterval(draw, intervalMs)
  }

  watch([video, canvas, active], start, { immediate: true })
  onBeforeUnmount(stop)

  return { canvas, draw, start, stop }
}
