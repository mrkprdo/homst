import { ref } from "vue"
import { nestApi, type NestTemperatures } from "@/api/nest"

const status = ref<NestTemperatures | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)

let refreshTimer: ReturnType<typeof setInterval> | null = null
let consumers = 0
let inFlight: Promise<void> | null = null

const EMPTY: NestTemperatures = {
  configured: false,
  authType: null,
  connected: false,
  rooms: [],
  history: {},
  updatedAt: null,
  error: null,
}

function normalizeHistory(data: unknown): Record<string, Array<[number, number]>> {
  if (!data || typeof data !== "object" || Array.isArray(data)) return {}
  const history: Record<string, Array<[number, number]>> = {}
  for (const [roomId, samples] of Object.entries(data)) {
    if (!Array.isArray(samples)) continue
    const points = samples.filter(
      (pair): pair is [number, number] =>
        Array.isArray(pair)
        && pair.length === 2
        && typeof pair[0] === "number"
        && typeof pair[1] === "number",
    )
    if (points.length) history[roomId] = points
  }
  return history
}

function normalize(data: unknown): NestTemperatures {
  if (!data || typeof data !== "object" || Array.isArray(data)) return { ...EMPTY }
  const value = data as Partial<NestTemperatures>
  return {
    configured: value.configured === true,
    authType: value.authType === "google" || value.authType === "nest" ? value.authType : null,
    connected: value.connected === true,
    rooms: Array.isArray(value.rooms) ? value.rooms : [],
    history: normalizeHistory(value.history),
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : null,
    error: typeof value.error === "string" ? value.error : null,
  }
}

async function refresh(force = false): Promise<void> {
  if (inFlight) return inFlight
  inFlight = (async () => {
    if (!status.value) loading.value = true
    error.value = null
    try {
      status.value = normalize(await nestApi.getTemperatures(force))
    } catch (err) {
      error.value = err instanceof Error ? err.message : "Could not load indoor temperatures."
    } finally {
      loading.value = false
      inFlight = null
    }
  })()
  return inFlight
}

function startAutoRefresh() {
  consumers++
  if (refreshTimer !== null) return
  refreshTimer = setInterval(() => { void refresh() }, 60_000)
}

function stopAutoRefresh() {
  consumers = Math.max(0, consumers - 1)
  if (consumers === 0 && refreshTimer !== null) {
    clearInterval(refreshTimer)
    refreshTimer = null
  }
}

function applyStatus(next: unknown) {
  status.value = normalize(next)
}

export function useNest() {
  return {
    status,
    loading,
    error,
    refresh,
    applyStatus,
    startAutoRefresh,
    stopAutoRefresh,
  }
}

export function _resetNest() {
  status.value = null
  loading.value = false
  error.value = null
  consumers = 0
  inFlight = null
  if (refreshTimer !== null) {
    clearInterval(refreshTimer)
    refreshTimer = null
  }
}
