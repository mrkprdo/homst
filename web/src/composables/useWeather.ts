import { ref } from "vue"
import { api } from "@/api/client"

const COORDS_KEY = "homst:weather-coords"

interface Coords { lat: number; lon: number }

export interface WeatherData {
  temp: number
  feelsLike: number
  high: number
  low: number
  code: number
  humidity: number
  windSpeed: number
  location: string
  lat: number
  lon: number
}

const weather = ref<WeatherData | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)

let autoRefreshTimer: ReturnType<typeof setInterval> | null = null
let lastOpts: Parameters<typeof refresh>[0] = undefined

function getCachedCoords(): Coords | null {
  try {
    const raw = localStorage.getItem(COORDS_KEY)
    if (!raw) return null
    return JSON.parse(raw) as Coords
  } catch { return null }
}

function setCachedCoords(lat: number, lon: number) {
  localStorage.setItem(COORDS_KEY, JSON.stringify({ lat, lon }))
}

interface GeoResult { lat: number; lon: number; name: string }

function normalizeCountryCode(country?: string): string | null {
  if (!country) return null
  const code = country.trim().toUpperCase()
  return code.length === 2 && /^[A-Z]{2}$/.test(code) ? code : null
}

async function geocode(address?: string, province?: string, country?: string): Promise<GeoResult | null> {
  const countryCode = normalizeCountryCode(country)

  // Candidate queries, most specific first. The country is passed as the
  // `countryCode` filter parameter, NEVER appended to the name — appending a
  // 2-letter code like "CA" makes Open-Meteo read it as a US state
  // (e.g. "Ontario, CA" resolves to Ontario, California instead of Canada).
  const candidates: string[] = []
  const full = [address, province].filter(Boolean).join(", ")
  if (full) candidates.push(full)
  if (address) {
    candidates.push(address)
    // Street addresses aren't geocodable by Open-Meteo (city-level only) —
    // fall back to the city portion (last comma segment).
    const city = address.split(",").pop()?.trim()
    if (city && !candidates.includes(city)) candidates.push(city)
  }
  if (province && !candidates.includes(province)) candidates.push(province)

  for (const name of candidates) {
    const params = new URLSearchParams({ name, count: "10", language: "en", format: "json" })
    if (countryCode) params.set("countryCode", countryCode)
    const res = await fetch(`https://geocoding-api.open-meteo.com/v1/search?${params}`)
    if (!res.ok) continue
    const data = await res.json()
    for (const r of data.results ?? []) {
      // When a country code is known, only accept results from it —
      // prevents "Ontario" from matching Ontario, California.
      if (countryCode && (r.country_code ?? "").toUpperCase() !== countryCode) continue
      return { lat: r.latitude, lon: r.longitude, name: r.name }
    }
  }
  return null
}

async function fetchWeather(lat: number, lon: number, location: string, retried = false): Promise<WeatherData | null> {
  const params = new URLSearchParams({
    latitude: lat.toFixed(4),
    longitude: lon.toFixed(4),
    current: "temperature_2m,apparent_temperature,weather_code,relative_humidity_2m,wind_speed_10m",
    daily: "temperature_2m_max,temperature_2m_min,weather_code",
    wind_speed_unit: "kmh",
    timezone: "auto",
  })
  const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`)
  if (!res.ok) throw new Error(`Weather API: ${res.status}`)
  const data = await res.json()

  if (!data.daily || !data.daily.temperature_2m_max?.[0]) {
    if (!retried) {
      const fallback = { lat: 40.7128, lon: -74.0060 }
      return fetchWeather(fallback.lat, fallback.lon, "New York", true)
    }
    return null
  }

  return {
    temp: Math.round(data.current.temperature_2m),
    feelsLike: Math.round(data.current.apparent_temperature),
    high: Math.round(data.daily.temperature_2m_max[0]),
    low: Math.round(data.daily.temperature_2m_min[0]),
    code: data.current.weather_code,
    humidity: Math.round(data.current.relative_humidity_2m),
    windSpeed: Math.round(data.current.wind_speed_10m),
    location,
    lat,
    lon,
  }
}

interface RefreshOpts {
  address?: string
  country?: string
  province?: string
  lat?: number
  lon?: number
}

async function refresh(opts?: RefreshOpts) {
  loading.value = true
  error.value = null

  try {
    let coords: Coords
    let locationName: string

    if (opts?.lat != null && opts?.lon != null) {
      coords = { lat: opts.lat, lon: opts.lon }
      locationName = opts.address ?? "Local"

    } else {
      let geo: GeoResult | null = null
      if (opts?.address || opts?.province || opts?.country) {
        geo = await geocode(opts?.address, opts?.province, opts?.country)
      }

      if (geo) {
        coords = { lat: geo.lat, lon: geo.lon }
        locationName = geo.name
        setCachedCoords(geo.lat, geo.lon)
        api.patch("/household/settings", { settings: { lat: geo.lat, lon: geo.lon } }).catch(() => {})
      } else {
        const cached = getCachedCoords()
        if (cached) {
          coords = cached
          locationName = opts?.address ?? "Local"
        } else {
          const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
            navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 8000 })
          ).catch(() => null)
          if (pos) {
            coords = { lat: pos.coords.latitude, lon: pos.coords.longitude }
            locationName = "Local"
            setCachedCoords(coords.lat, coords.lon)
          } else {
            coords = { lat: 40.7128, lon: -74.0060 }
            locationName = "New York"
            setCachedCoords(coords.lat, coords.lon)
          }
        }
      }
    }

    weather.value = await fetchWeather(coords.lat, coords.lon, locationName)
    lastOpts = opts
  } catch {
    error.value = "Could not load weather"
  } finally {
    loading.value = false
  }
}

function startAutoRefresh(opts?: RefreshOpts) {
  stopAutoRefresh()
  lastOpts = opts
  autoRefreshTimer = setInterval(() => refresh(lastOpts), 30 * 60 * 1000)
}

function stopAutoRefresh() {
  if (autoRefreshTimer !== null) {
    clearInterval(autoRefreshTimer)
    autoRefreshTimer = null
  }
}

const WMO_DESCRIPTION: Record<number, string> = {
  0: "Clear", 1: "Mostly clear", 2: "Partly cloudy", 3: "Overcast",
  45: "Foggy", 48: "Foggy",
  51: "Light drizzle", 53: "Drizzle", 55: "Heavy drizzle",
  56: "Freezing drizzle", 57: "Freezing drizzle",
  61: "Light rain", 63: "Rain", 65: "Heavy rain",
  66: "Freezing rain", 67: "Freezing rain",
  71: "Light snow", 73: "Snow", 75: "Heavy snow",
  77: "Snow grains",
  80: "Rain showers", 81: "Rain showers", 82: "Heavy rain showers",
  85: "Snow showers", 86: "Heavy snow showers",
  95: "Thunderstorm", 96: "Thunderstorm", 99: "Thunderstorm",
}

function weatherLabel(code: number): string {
  return WMO_DESCRIPTION[code] ?? "Unknown"
}

export function useWeather() {
  return { weather, loading, error, refresh, startAutoRefresh, stopAutoRefresh, weatherLabel }
}
