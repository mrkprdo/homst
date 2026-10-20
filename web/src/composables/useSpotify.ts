import { ref } from "vue"

const CLIENT_ID_KEY = "homst:spotify-client-id"

function ls(): Storage {
  try { if (typeof localStorage?.getItem === "function") return localStorage } catch {}
  return { getItem: () => null, setItem: () => {}, removeItem: () => {} } as unknown as Storage
}
const TOKEN_KEY = "homst:spotify-token"
const CODE_VERIFIER_KEY = "homst:spotify-code-verifier"

const AUTH_URL = "https://accounts.spotify.com/authorize"
const TOKEN_URL = "https://accounts.spotify.com/api/token"
const API_BASE = "https://api.spotify.com/v1"

export interface SpotifyTrack {
  id: string
  name: string
  artists: string
  albumArt: string
  progressMs: number
  durationMs: number
  isPlaying: boolean
}

const currentTrack = ref<SpotifyTrack | null>(null)
const connected = ref(false)
const clientId = ref("")
const error = ref<string | null>(null)

function loadStoredClientId(): string {
  try { return ls().getItem(CLIENT_ID_KEY) || "" } catch { return "" }
}

// A build-time VITE_SPOTIFY_CLIENT_ID (dev / self-built images) beats the
// per-browser value; a server-wide SPOTIFY_CLIENT_ID is adopted in init().
const envClientId = (import.meta.env.VITE_SPOTIFY_CLIENT_ID || "").trim()
clientId.value = envClientId || loadStoredClientId()

const CLIENT_ID_PATTERN = /^[0-9a-f]{32}$/i

function getRedirectUri(): string {
  const { protocol, hostname, port } = window.location
  if (protocol === "http:" && !port) return `${protocol}//${hostname}:80`
  return window.location.origin
}

let pollTimer: ReturnType<typeof setInterval> | null = null
let elapsedTimer: ReturnType<typeof setInterval> | null = null
let lastFetchProgress = 0
let lastFetchTime = 0

function generateCodeVerifier(): string {
  const array = new Uint8Array(32)
  crypto.getRandomValues(array)
  return base64url(array)
}

function sha256(data: Uint8Array): Uint8Array {
  const K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ])
  const H0 = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ])
  const bitLen = data.length * 8
  const padLen = ((data.length + 9 + 63) & ~63)
  const padded = new Uint8Array(padLen)
  padded.set(data)
  padded[data.length] = 0x80
  new DataView(padded.buffer).setUint32(padLen - 4, bitLen >>> 0, false)
  new DataView(padded.buffer).setUint32(padLen - 8, (bitLen / 0x100000000) >>> 0, false)
  const H = H0.slice()
  const W = new Uint32Array(64)
  for (let off = 0; off < padLen; off += 64) {
    const view = new DataView(padded.buffer, off, 64)
    for (let t = 0; t < 16; t++) W[t] = view.getUint32(t * 4, false)
    for (let t = 16; t < 64; t++) {
      const s0 = rotr(W[t - 15], 7) ^ rotr(W[t - 15], 18) ^ (W[t - 15] >>> 3)
      const s1 = rotr(W[t - 2], 17) ^ rotr(W[t - 2], 19) ^ (W[t - 2] >>> 10)
      W[t] = (W[t - 16] + s0 + W[t - 7] + s1) >>> 0
    }
    let [a, b, c, d, e, f, g, h] = Array.from(H)
    for (let t = 0; t < 64; t++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)
      const ch = (e & f) ^ ((~e) & g)
      const temp1 = (h + S1 + ch + K[t] + W[t]) >>> 0
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)
      const maj = (a & b) ^ (a & c) ^ (b & c)
      const temp2 = (S0 + maj) >>> 0
      ;[a, b, c, d, e, f, g, h] = [(temp1 + temp2) >>> 0, a, b, c, (d + temp1) >>> 0, e, f, g]
    }
    H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0
    H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0
    H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0
    H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0
  }
  const out = new Uint8Array(32)
  const dv = new DataView(out.buffer)
  for (let i = 0; i < 8; i++) dv.setUint32(i * 4, H[i], false)
  return out
  function rotr(x: number, n: number): number { return (x >>> n) | (x << (32 - n)) }
}

function base64url(buf: Uint8Array): string {
  return btoa(String.fromCharCode(...buf)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

async function generateCodeChallenge(verifier: string): Promise<{ method: string; challenge: string }> {
  const encoder = new TextEncoder()
  const data = encoder.encode(verifier)

  let digest: Uint8Array
  if (typeof crypto !== "undefined" && crypto.subtle) {
    const buf = await crypto.subtle.digest("SHA-256", data)
    digest = new Uint8Array(buf)
  } else {
    digest = sha256(data)
  }

  return { method: "S256", challenge: base64url(digest) }
}

interface StoredToken {
  accessToken: string
  refreshToken: string
  expiresAt: number
}

function getStoredToken(): StoredToken | null {
  try {
    const raw = ls().getItem(TOKEN_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function storeToken(accessToken: string, refreshToken: string, expiresIn: number) {
  const token: StoredToken = {
    accessToken,
    refreshToken,
    expiresAt: Date.now() + expiresIn * 1000,
  }
  ls().setItem(TOKEN_KEY, JSON.stringify(token))
}

function clearToken() {
  ls().removeItem(TOKEN_KEY)
}

async function refreshAccessToken(refreshToken: string): Promise<boolean> {
  const cid = clientId.value
  if (!cid) return false
  try {
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: cid,
      }),
    })
    const data = await res.json()
    if (data.access_token) {
      storeToken(data.access_token, data.refresh_token || refreshToken, data.expires_in)
      return true
    }
    return false
  } catch {
    return false
  }
}

async function getValidToken(): Promise<string | null> {
  const token = getStoredToken()
  if (!token) return null

  if (token.expiresAt < Date.now() + 300000) {
    const ok = await refreshAccessToken(token.refreshToken)
    if (!ok) {
      clearToken()
      return null
    }
    const updated = getStoredToken()
    return updated?.accessToken ?? null
  }

  return token.accessToken
}

async function fetchCurrentlyPlaying(): Promise<void> {
  const token = await getValidToken()
  if (!token) {
    connected.value = false
    return
  }

  try {
    const res = await fetch(`${API_BASE}/me/player/currently-playing`, {
      headers: { Authorization: `Bearer ${token}` },
    })

    if (res.status === 204) {
      if (currentTrack.value) {
        currentTrack.value = { ...currentTrack.value, isPlaying: false }
      }
      return
    }

    if (res.status === 401) {
      clearToken()
      connected.value = false
      currentTrack.value = null
      return
    }

    const data = await res.json()

    if (data?.item) {
      lastFetchProgress = data.progress_ms
      lastFetchTime = Date.now()
      currentTrack.value = {
        id: data.item.id,
        name: data.item.name,
        artists: data.item.artists.map((a: { name: string }) => a.name).join(", "),
        albumArt: data.item.album.images[0]?.url || "",
        progressMs: data.progress_ms,
        durationMs: data.item.duration_ms,
        isPlaying: data.is_playing,
      }
      connected.value = true
      error.value = null
    }
  } catch (e) {
    error.value = "Could not reach Spotify"
  }
}

function startPolling() {
  stopPolling()
  fetchCurrentlyPlaying()
  pollTimer = setInterval(fetchCurrentlyPlaying, 5000)
  elapsedTimer = setInterval(() => {
    if (currentTrack.value?.isPlaying) {
      const elapsed = Date.now() - lastFetchTime
      currentTrack.value.progressMs = Math.min(
        lastFetchProgress + elapsed,
        currentTrack.value.durationMs
      )
    }
  }, 1000)
}

function stopPolling() {
  if (pollTimer !== null) {
    clearInterval(pollTimer)
    pollTimer = null
  }
  if (elapsedTimer !== null) {
    clearInterval(elapsedTimer)
    elapsedTimer = null
  }
}

function setClientId(id: string) {
  clientId.value = id.trim()
  ls().setItem(CLIENT_ID_KEY, clientId.value)
}

function looksValid(cid: string): boolean {
  return CLIENT_ID_PATTERN.test(cid)
}

async function connect() {
  const cid = clientId.value
  if (!cid) {
    error.value = "Add your Spotify Client ID first"
    return
  }
  if (!looksValid(cid)) {
    error.value = "That doesn't look like a Spotify Client ID (32 letters/digits — not the Client Secret)"
    return
  }

  error.value = null
  const verifier = generateCodeVerifier()
  ls().setItem(CODE_VERIFIER_KEY, verifier)
  const { method, challenge } = await generateCodeChallenge(verifier)

  const redirectUri = getRedirectUri()
  const scope = "user-read-playback-state user-read-currently-playing"

  const params = new URLSearchParams({
    client_id: cid,
    response_type: "code",
    redirect_uri: redirectUri,
    code_challenge_method: method,
    code_challenge: challenge,
    scope,
  })

  window.location.href = `${AUTH_URL}?${params.toString()}`
}

async function handleCallback(): Promise<boolean> {
  const codeVerifier = ls().getItem(CODE_VERIFIER_KEY)
  const urlParams = new URLSearchParams(window.location.search)
  const oauthError = urlParams.get("error")
  const code = urlParams.get("code")

  if (oauthError) {
    // Spotify redirected back with a failure (user denied, app misconfigured…)
    error.value = oauthError === "access_denied"
      ? "Spotify access was denied"
      : `Spotify authorization failed (${oauthError})`
    ls().removeItem(CODE_VERIFIER_KEY)
    window.history.replaceState({}, document.title, window.location.pathname)
    return false
  }

  if (!code || !codeVerifier) return false

  const redirectUri = getRedirectUri()
  const cid = clientId.value

  try {
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        client_id: cid,
        code_verifier: codeVerifier,
      }),
    })

    const data = await res.json()
    if (data.access_token) {
      storeToken(data.access_token, data.refresh_token, data.expires_in)
      ls().removeItem(CODE_VERIFIER_KEY)
      window.history.replaceState({}, document.title, window.location.pathname)
      return true
    }
    error.value = "Authorization failed. Check your Client ID."
  } catch {
    error.value = "Authorization failed. Could not reach Spotify."
  }

  ls().removeItem(CODE_VERIFIER_KEY)
  window.history.replaceState({}, document.title, window.location.pathname)
  return false
}

let initialized = false

function needsConfig(): boolean {
  return !clientId.value
}

async function adoptServerClientId(): Promise<void> {
  try {
    const res = await fetch("/api/v1/config")
    if (res.ok) {
      const data = await res.json()
      const serverId = data?.spotify_client_id ? String(data.spotify_client_id).trim() : ""
      if (serverId && serverId !== clientId.value) {
        clientId.value = serverId
        ls().setItem(CLIENT_ID_KEY, serverId)
      }
    }
  } catch {
    // Offline or older server — the widget still offers manual entry.
  }
}

async function init() {
  if (initialized) return
  initialized = true

  const wasCallback = await handleCallback()

  // Adopt the server-wide Client ID (SPOTIFY_CLIENT_ID in .env) only
  // after the callback exchange — that exchange must use the ID from the
  // authorize request. Afterwards the server value wins over a stale
  // per-browser one; authorized sessions already have their token instead.
  if (!getStoredToken()) await adoptServerClientId()

  if (wasCallback || getStoredToken()) {
    connected.value = true
    startPolling()
  }
}

function disconnect() {
  stopPolling()
  clearToken()
  connected.value = false
  currentTrack.value = null
  error.value = null
}

function formatTime(ms: number): string {
  const totalSec = Math.floor(ms / 1000)
  const min = Math.floor(totalSec / 60)
  const sec = totalSec % 60
  return `${min}:${sec.toString().padStart(2, "0")}`
}

export function useSpotify() {
  return {
    currentTrack,
    connected,
    clientId,
    error,
    needsConfig,
    setClientId,
    connect,
    init,
    disconnect,
    formatTime,
  }
}
