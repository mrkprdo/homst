import { onBeforeUnmount, ref, watch, type Ref } from "vue"
import Hls from "hls.js"

export type CameraStatus = "idle" | "loading" | "playing" | "error"

const STREAM_ERROR = "The camera stream stopped. Check the URL and credentials in Settings."
const NETWORK_ERROR = "Could not reach the camera stream. Check the URL and credentials in Settings."
const UNAVAILABLE_ERROR = "Camera streaming is unavailable. Check that ffmpeg is installed on the server."
const NOT_FOUND_ERROR = "Camera stream not found. Check the camera URL in Settings."
const TIMEOUT_ERROR = "The camera stream did not start. Check the URL and credentials in Settings."
const START_TIMEOUT_MS = 15_000

/**
 * Attach an HLS stream to a <video> element. Native HLS is used where the
 * browser supports it (Safari, iOS); everything else goes through hls.js.
 */
export function useCameraStream(streamPath: Ref<string | null>) {
  const video = ref<HTMLVideoElement | null>(null)
  const status = ref<CameraStatus>("idle")
  const error = ref("")
  let hls: Hls | null = null
  let networkRetries = 0
  let mediaRetries = 0
  let startTimer: ReturnType<typeof setTimeout> | null = null

  function clearStartTimer() {
    if (startTimer !== null) {
      clearTimeout(startTimer)
      startTimer = null
    }
  }

  function destroy() {
    clearStartTimer()
    if (hls) {
      hls.destroy()
      hls = null
    }
    const el = video.value
    if (!el) return
    el.removeAttribute("src")
    if (typeof el.load === "function") el.load()
  }

  function play(el: HTMLVideoElement) {
    const result = el.play()
    if (result && typeof result.catch === "function") result.catch(() => {})
  }

  function fail(message: string) {
    status.value = "error"
    error.value = message
    destroy()
  }

  /** Turn an hls.js network failure into the server's message when possible. */
  function networkMessage(data: { response?: { code?: number; text?: string } }) {
    const text = data.response?.text
    if (typeof text === "string" && text) {
      try {
        const body = JSON.parse(text)
        if (typeof body?.detail === "string" && body.detail) return body.detail
      } catch {
        // Not JSON — fall back to the status code below.
      }
    }
    if (data.response?.code === 404) return NOT_FOUND_ERROR
    if (data.response?.code === 503) return UNAVAILABLE_ERROR
    return NETWORK_ERROR
  }

  function start() {
    destroy()
    error.value = ""
    networkRetries = 0
    mediaRetries = 0
    const path = streamPath.value
    const el = video.value
    if (!path || !el) {
      status.value = "idle"
      return
    }

    status.value = "loading"
    startTimer = setTimeout(() => {
      if (status.value === "loading") fail(TIMEOUT_ERROR)
    }, START_TIMEOUT_MS)

    if (el.canPlayType("application/vnd.apple.mpegurl")) {
      el.src = path
      play(el)
      status.value = "playing"
      clearStartTimer()
      return
    }

    if (!Hls.isSupported()) {
      clearStartTimer()
      status.value = "error"
      error.value = "This browser cannot play HLS video."
      return
    }

    const instance = new Hls({
      lowLatencyMode: true,
      liveSyncDurationCount: 2,
      maxBufferLength: 10,
    })
    hls = instance
    instance.on(Hls.Events.ERROR, (_event, data) => {
      if (!data.fatal) return
      if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
        // An HTTP status means the API answered with a real problem (missing
        // stream, ffmpeg unavailable, bad URL). Retry only true network blips.
        if (data.response?.code) {
          fail(networkMessage(data))
          return
        }
        if (networkRetries++ < 1) {
          instance.startLoad()
          return
        }
        fail(NETWORK_ERROR)
        return
      }
      if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
        if (mediaRetries++ < 1) {
          instance.recoverMediaError()
          return
        }
        fail(STREAM_ERROR)
        return
      }
      fail(STREAM_ERROR)
    })
    instance.on(Hls.Events.MANIFEST_PARSED, () => {
      status.value = "playing"
      clearStartTimer()
      play(el)
    })
    instance.loadSource(path)
    instance.attachMedia(el)
  }

  watch([streamPath, video], start, { immediate: true })
  onBeforeUnmount(destroy)

  return { video, status, error, retry: start }
}
