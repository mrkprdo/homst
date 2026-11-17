import { onBeforeUnmount, ref, watch, type Ref } from "vue"
import Hls from "hls.js"

export type CameraStatus =
  | "idle"
  | "loading"
  | "playing"
  | "retrieving"
  | "failed"
  | "error"

const STREAM_ERROR = "The camera stream stopped. Check the URL and credentials in Settings."
const NETWORK_ERROR = "Could not reach the camera stream. Check the URL and credentials in Settings."
const UNAVAILABLE_ERROR = "Camera streaming is unavailable. Check that ffmpeg is installed on the server."
const NOT_FOUND_ERROR = "Camera stream not found. Check the camera URL in Settings."
const TIMEOUT_ERROR = "The camera stream did not start. Check the URL and credentials in Settings."
const START_TIMEOUT_MS = 15_000

const RETRIEVING_MESSAGE = "retrieving stream..."
const FAILED_RETRIEVING_MESSAGE = "failed retrieving stream"

/** How often the watchdog checks whether a new frame arrived. */
export const HEALTH_CHECK_INTERVAL_MS = 1_000
/**
 * How long frames may be missing before the stream counts as stalled.
 *
 * This is deliberately not a "segment should have arrived by now" timer. A
 * weakly connected client can spend 10–20s downloading one 2s segment, and
 * `timeupdate` is silent for that whole window. Tripping at 8s turned normal
 * re-buffering on a Pi into an error card.
 */
export const STALL_TIMEOUT_MS = 20_000
/** Reconnect cadence after every immediate recovery attempt has failed. */
export const RETRY_INTERVAL_MS = 60_000
/** Immediate recovery attempts before falling back to the slow cadence. */
export const MAX_RETRIES = 3
/** hls.js network recoveries that are safe to retry before giving up. */
const MAX_NETWORK_RETRIES = 2
/** Media recoveries (buffer re-append) before the pipeline is declared dead. */
const MAX_MEDIA_RETRIES = 2

/**
 * Attach an HLS stream to a <video> element and watchdog it. Playback goes
 * through hls.js wherever MSE exists; browsers without it (Safari, iOS) fall
 * back to native HLS.
 *
 * When no frame arrives for `STALL_TIMEOUT_MS`, the stream is flagged as
 * "retrieving" and the pipeline is nudged. After `MAX_RETRIES` failed nudges
 * it stays "failed" and reconnects every `RETRY_INTERVAL_MS` until frames
 * return.
 *
 * "A frame arrived" means two things: the playback clock advanced
 * (`timeupdate`) and, where the browser supports it, a frame was actually
 * presented for composition (`requestVideoFrameCallback`). Low-power
 * Chromium can keep the clock running while the decoder or video overlay is
 * stuck — a frozen picture that `timeupdate` alone would never notice. That
 * case rebuilds the whole pipeline instead of nudging the loader.
 */
export function useCameraStream(streamPath: Ref<string | null>) {
  const video = ref<HTMLVideoElement | null>(null)
  const status = ref<CameraStatus>("idle")
  const error = ref("")
  let hls: Hls | null = null
  let networkRetries = 0
  let mediaRetries = 0
  let startTimer: ReturnType<typeof setTimeout> | null = null
  let watchdogTimer: ReturnType<typeof setInterval> | null = null
  let retryTimer: ReturnType<typeof setTimeout> | null = null
  let retrieveAttempts = 0
  let lastFrameAt = 0
  // Rendered-frame watchdog. `timeupdate` tracks the playback clock, which on a
  // stuck hardware decoder keeps advancing while the picture is frozen.
  // requestVideoFrameCallback fires only when a frame reaches the compositor,
  // so it is the one signal that can see that freeze.
  let lastRenderAt = 0
  let renderSupported = false
  let renderGen = 0
  let renderHandle = 0

  function clearStartTimer() {
    if (startTimer !== null) {
      clearTimeout(startTimer)
      startTimer = null
    }
  }

  function stopWatchdog() {
    if (watchdogTimer !== null) {
      clearInterval(watchdogTimer)
      watchdogTimer = null
    }
  }

  function clearRetryTimer() {
    if (retryTimer !== null) {
      clearTimeout(retryTimer)
      retryTimer = null
    }
  }

  function clearTimers() {
    clearStartTimer()
    stopWatchdog()
    clearRetryTimer()
  }

  function play(el: HTMLVideoElement) {
    const result = el.play()
    if (result && typeof result.catch === "function") result.catch(() => {})
  }

  /** Stop the rendered-frame loop; a generation guard kills pending callbacks. */
  function stopRenderWatch() {
    renderGen += 1
    const el = video.value
    if (el && renderHandle && typeof el.cancelVideoFrameCallback === "function") {
      el.cancelVideoFrameCallback(renderHandle)
    }
    renderHandle = 0
  }

  /** Track frames actually presented for composition, where the browser can. */
  function startRenderWatch(el: HTMLVideoElement) {
    renderSupported = typeof el.requestVideoFrameCallback === "function"
    if (!renderSupported) return
    const gen = renderGen
    lastRenderAt = Date.now()
    const tick = () => {
      if (gen !== renderGen) return
      lastRenderAt = Date.now()
      markFrame()
      renderHandle = el.requestVideoFrameCallback(tick)
    }
    renderHandle = el.requestVideoFrameCallback(tick)
  }

  /** Tear down the current pipeline without touching the status. */
  function teardown() {
    stopRenderWatch()
    if (hls) {
      hls.destroy()
      hls = null
    }
    const el = video.value
    if (!el) return
    el.removeEventListener("timeupdate", onTimeUpdate)
    el.removeAttribute("src")
    if (typeof el.load === "function") el.load()
  }

  function destroy() {
    clearTimers()
    teardown()
  }

  function fail(message: string) {
    status.value = "error"
    error.value = message
    destroy()
    // A kiosk has nobody to press "Try again". A camera hiccup can take the
    // stream down for a while, and a Wi-Fi blip can outlast the immediate
    // retries — both answer with a transient HTTP/network error. Treat every
    // failure as recoverable and reconnect on the slow cadence.
    scheduleRetry()
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

  function startWatchdog() {
    stopWatchdog()
    watchdogTimer = setInterval(() => {
      const active = status.value === "playing" || status.value === "retrieving"
      if (!active) return
      const now = Date.now()
      const clockStalled = now - lastFrameAt >= STALL_TIMEOUT_MS
      // A frozen decoder can leave the clock (and `timeupdate`) running, so
      // also watch presented frames. Only while the page is visible: a
      // background tab stops composing frames without anything being broken.
      const renderStalled =
        renderSupported &&
        document.visibilityState === "visible" &&
        now - lastRenderAt >= STALL_TIMEOUT_MS
      if (clockStalled || renderStalled) handleStall(renderStalled)
    }, HEALTH_CHECK_INTERVAL_MS)
  }

  /** Called whenever the video advances. */
  function markFrame() {
    lastFrameAt = Date.now()
    if (status.value !== "retrieving") return
    status.value = "playing"
    error.value = ""
    retrieveAttempts = 0
    clearRetryTimer()
  }

  function onTimeUpdate() {
    markFrame()
  }

  /** Nudge the current pipeline so it fetches fresh segments. */
  function recoverStream() {
    if (hls) {
      hls.startLoad()
    } else {
      const el = video.value
      if (el) {
        el.load()
        play(el)
      }
    }
  }

  function scheduleRetry() {
    clearRetryTimer()
    retryTimer = setTimeout(() => {
      retryTimer = null
      start()
    }, RETRY_INTERVAL_MS)
  }

  function handleStall(decoderStuck = false) {
    retrieveAttempts += 1
    if (retrieveAttempts > MAX_RETRIES) {
      status.value = "failed"
      error.value = FAILED_RETRIEVING_MESSAGE
      stopWatchdog()
      scheduleRetry()
      return
    }
    status.value = "retrieving"
    error.value = RETRIEVING_MESSAGE
    lastFrameAt = Date.now()
    lastRenderAt = Date.now()
    if (decoderStuck) {
      // The loader is healthy but the decoder/overlay is frozen; nudging the
      // loader cannot fix that. Rebuild the whole pipeline (fresh MediaSource
      // and decoder) while keeping the recovery budget, so a decoder that
      // stays dead still escalates to the slow reconnect cadence.
      destroy()
      beginPlayback()
      return
    }
    recoverStream()
    startWatchdog()
  }

  function beginPlayback() {
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

    // Prefer hls.js wherever MSE is available, even when the browser claims
    // native HLS support. Chromium on some displays advertises support and then
    // re-fetches the playlist in a zero-delay loop — one wall display polled a
    // 2s-target playlist ~45 times a second and pinned a core. hls.js reloads
    // on the playlist's own cadence, so it is the safe default. Only browsers
    // without MSE (Safari, iOS) still need the native path.
    if (!Hls.isSupported()) {
      if (!el.canPlayType("application/vnd.apple.mpegurl")) {
        clearStartTimer()
        status.value = "error"
        error.value = "This browser cannot play HLS video."
        return
      }
      el.addEventListener("timeupdate", onTimeUpdate)
      el.src = path
      play(el)
      status.value = "playing"
      clearStartTimer()
      lastFrameAt = Date.now()
      startRenderWatch(el)
      startWatchdog()
      return
    }

    const instance = new Hls({
      // The server produces ordinary 2s HLS segments, not LL-HLS parts.
      lowLatencyMode: false,
      liveSyncDurationCount: 3,
      // A weak client will drift behind live now and then. Let it ride that out
      // and keep playing the older segments instead of snapping to the live
      // edge, which is the visible "frame skip". The server keeps a long enough
      // window (see HLS_LIST_SIZE) that this can never run past the segments
      // that still exist.
      liveMaxLatencyDurationCount: 30,
      // Modest buffers: a client whose link is slower than realtime cannot fill
      // a large buffer anyway, and asking for 20s at once starves the segment
      // that is about to be played.
      maxBufferLength: 12,
      maxMaxBufferLength: 24,
      backBufferLength: 10,
    })
    hls = instance
    // Playback progress is the real "frames are arriving" signal. Counting
    // FRAG_LOADED events wrongly treats a buffered stream or one slow
    // segment download as a stall.
    el.addEventListener("timeupdate", onTimeUpdate)
    instance.on(Hls.Events.ERROR, (_event, data) => {
      if (!data.fatal) return
      // A segment pruned from the live window (or a segment that vanished while
      // the client was far behind) is not a stream failure: hls.js skips past it
      // and keeps playing. Only a missing playlist means the stream is gone.
      if (data.response?.code === 404 && data.frag) return
      if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
        // An HTTP status means the API answered with a real problem (missing
        // stream, ffmpeg unavailable, bad URL). Retry only true network blips.
        if (data.response?.code) {
          fail(networkMessage(data))
          return
        }
        if (networkRetries++ < MAX_NETWORK_RETRIES) {
          instance.startLoad()
          return
        }
        fail(NETWORK_ERROR)
        return
      }
      if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
        if (mediaRetries++ < MAX_MEDIA_RETRIES) {
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
      lastFrameAt = Date.now()
      startRenderWatch(el)
      startWatchdog()
    })
    instance.loadSource(path)
    instance.attachMedia(el)
  }

  /** (Re)connect from scratch, resetting the recovery budget. */
  function start() {
    destroy()
    error.value = ""
    networkRetries = 0
    mediaRetries = 0
    retrieveAttempts = 0
    beginPlayback()
  }

  watch([streamPath, video], start, { immediate: true })
  onBeforeUnmount(destroy)

  return { video, status, error, retry: start }
}
