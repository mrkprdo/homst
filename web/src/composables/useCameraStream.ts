import { onBeforeUnmount, ref, watch, type Ref } from "vue"

export type CameraStatus =
  | "idle"
  | "loading"
  | "playing"
  | "retrieving"
  | "failed"
  | "error"

export interface CameraStreamOptions {
  onFreeze?: (video: HTMLVideoElement) => void
}

const STREAM_ERROR = "The camera stream stopped. Check the URL and credentials in Settings."
const NETWORK_ERROR = "Could not reach the camera stream. Check the URL and credentials in Settings."
const UNAVAILABLE_ERROR = "Camera streaming is unavailable. Check that ffmpeg is installed on the server."
const NOT_FOUND_ERROR = "Camera stream not found. Check the camera URL in Settings."
const TIMEOUT_ERROR = "The camera stream did not start. Check the URL and credentials in Settings."
const START_TIMEOUT_MS = 15_000

const RETRIEVING_MESSAGE = "retrieving stream..."
const FAILED_RETRIEVING_MESSAGE = "failed retrieving stream"

type HlsModule = typeof import("hls.js")

let hlsModule: Promise<HlsModule> | null = null
function loadHls(): Promise<HlsModule> {
  hlsModule ??= import("hls.js").catch((error) => {
    hlsModule = null
    throw error
  })
  return hlsModule
}

function hasMediaSource(): boolean {
  if (typeof window === "undefined") return false
  const w = window as Window & { MediaSource?: unknown; ManagedMediaSource?: unknown }
  return typeof w.MediaSource !== "undefined" || typeof w.ManagedMediaSource !== "undefined"
}

export const HEALTH_CHECK_INTERVAL_MS = 1_000
export const STALL_TIMEOUT_MS = 20_000
export const RETRY_INTERVAL_MS = 60_000
export const MAX_RETRIES = 3
const MAX_NETWORK_RETRIES = 2
const MAX_MEDIA_RETRIES = 2

export function useCameraStream(
  streamPath: Ref<string | null>,
  options: CameraStreamOptions = {},
) {
  const video = ref<HTMLVideoElement | null>(null)
  const status = ref<CameraStatus>("idle")
  const error = ref("")
  let hls: InstanceType<HlsModule["default"]> | null = null
  let networkRetries = 0
  let mediaRetries = 0
  let startTimer: ReturnType<typeof setTimeout> | null = null
  let watchdogTimer: ReturnType<typeof setInterval> | null = null
  let retryTimer: ReturnType<typeof setTimeout> | null = null
  let retrieveAttempts = 0
  let lastFrameAt = 0
  let lastRenderAt = 0
  let renderSupported = false
  let renderGen = 0
  let renderHandle = 0
  let playbackGen = 0

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

  function freezeFrame() {
    const el = video.value
    if (el) options.onFreeze?.(el)
  }

  function play(el: HTMLVideoElement) {
    const result = el.play()
    if (result && typeof result.catch === "function") result.catch(() => {})
  }

  function stopRenderWatch() {
    renderGen += 1
    const el = video.value
    if (el && renderHandle && typeof el.cancelVideoFrameCallback === "function") {
      el.cancelVideoFrameCallback(renderHandle)
    }
    renderHandle = 0
  }

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
    playbackGen += 1
    clearTimers()
    teardown()
  }

  function fail(message: string) {
    freezeFrame()
    status.value = "error"
    error.value = message
    destroy()
    scheduleRetry()
  }

  function networkMessage(data: { response?: { code?: number; text?: string } }) {
    const text = data.response?.text
    if (typeof text === "string" && text) {
      try {
        const body = JSON.parse(text)
        if (typeof body?.detail === "string" && body.detail) return body.detail
      } catch {
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
      const renderStalled =
        renderSupported &&
        document.visibilityState === "visible" &&
        now - lastRenderAt >= STALL_TIMEOUT_MS
      if (clockStalled || renderStalled) handleStall(renderStalled)
    }, HEALTH_CHECK_INTERVAL_MS)
  }

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

  function recoverStream() {
    freezeFrame()
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
      freezeFrame()
      destroy()
      void beginPlayback()
      return
    }
    recoverStream()
    startWatchdog()
  }

  async function beginPlayback() {
    const gen = ++playbackGen
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

    const useNative = () => {
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
    }

    if (!hasMediaSource()) {
      useNative()
      return
    }

    let Hls: HlsModule["default"]
    try {
      Hls = (await loadHls()).default
    } catch {
      if (gen === playbackGen) fail(STREAM_ERROR)
      return
    }
    if (gen !== playbackGen) return

    if (!Hls.isSupported()) {
      useNative()
      return
    }

    const instance = new Hls({
      lowLatencyMode: false,
      liveSyncDurationCount: 3,
      liveMaxLatencyDurationCount: 30,
      maxBufferLength: 12,
      maxMaxBufferLength: 24,
      backBufferLength: 10,
    })
    hls = instance
    el.addEventListener("timeupdate", onTimeUpdate)
    instance.on(Hls.Events.ERROR, (_event, data) => {
      if (!data.fatal) return
      if (data.response?.code === 404 && data.frag) return
      if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
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

  function start() {
    freezeFrame()
    destroy()
    error.value = ""
    networkRetries = 0
    mediaRetries = 0
    retrieveAttempts = 0
    void beginPlayback()
  }

  watch([streamPath, video], start, { immediate: true })
  onBeforeUnmount(destroy)

  return { video, status, error, retry: start }
}
