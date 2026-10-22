const BASE_URL = "/api/v1"

export type UpdateState =
  | "queued"
  | "pulling"
  | "restarting"
  | "verifying"
  | "rolling_back"
  | "success"
  | "up_to_date"
  | "rolled_back"
  | "failed"

export interface SystemRelease {
  version: string
  tag: string
  name: string
  published_at: string | null
  html_url: string | null
  notes: string
  current: boolean
  latest: boolean
  previous: boolean
  held: boolean
  major: boolean
  newer: boolean
}

export interface SystemJob {
  id: string
  state: UpdateState
  version: string
  latest: boolean
  message: string
  progress: { percent: number; bytes: number; total: number }
  error: string | null
  from_version: string | null
  to_version: string
  started_at: string
  finished_at: string | null
}

export interface SystemStatus {
  current: {
    version: string
    commit: string
    image: string | null
    tag: string | null
    digest: string | null
    channel: "stable" | "nightly" | "pinned" | "custom"
  }
  latest: SystemRelease | null
  update_available: boolean
  releases: SystemRelease[]
  previous: { version: string | null; image: string | null }
  held: { version: string | null; reason: string | null }
  job: SystemJob | null
  auto: {
    enabled: boolean
    checkIntervalMinutes: number
  }
  update_prompt: {
    version: string | null
    dismissed: boolean
  }
  self_update: {
    available: boolean
    managed: boolean
    reason: string | null
    mode: "managed" | "manual"
  }
  manual: { current: string; stable: string }
  checked_at: string | null
  stale: boolean
  error: string | null
  // Fields the server may omit during a partial/older response.
  [key: string]: unknown
}

async function request<T>(
  url: string,
  options: RequestInit = {},
  timeoutMs = 0,
): Promise<T> {
  // Update polling must never wedge on a half-open connection while the app
  // restarts; abort and let the caller retry against the new container.
  const controller = timeoutMs > 0 ? new AbortController() : null
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null
  try {
    const response = await fetch(`${BASE_URL}${url}`, {
      credentials: "include",
      ...options,
      signal: controller?.signal ?? options.signal,
      headers: {
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...options.headers,
      },
    })

    if (!response.ok) {
      const body = await response.json().catch(() => ({}))
      throw new Error(body.detail ?? `Request failed: ${response.status}`)
    }
    return response.json() as Promise<T>
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export const systemApi = {
  getStatus(refresh = false): Promise<SystemStatus> {
    return request<SystemStatus>(`/system/status${refresh ? "?refresh=true" : ""}`, {}, 20000)
  },

  getJob(): Promise<{ job: SystemJob | null } & Record<string, unknown>> {
    return request("/system/job", {}, 10000)
  },

  install(version: string, retry = false): Promise<SystemJob> {
    return request<SystemJob>(
      "/system/install",
      {
        method: "POST",
        headers: { "X-HOMST-Update": "1" },
        body: JSON.stringify({ version, retry }),
      },
      15000,
    )
  },

  dismissPrompt(version: string): Promise<{ dismissed: string }> {
    return request<{ dismissed: string }>(
      "/system/prompt/dismiss",
      {
        method: "POST",
        headers: { "X-HOMST-Update": "1" },
        body: JSON.stringify({ version }),
      },
      15000,
    )
  },

  retryRollback(): Promise<SystemJob> {
    return request<SystemJob>(
      "/system/recovery/retry-rollback",
      {
        method: "POST",
        headers: { "X-HOMST-Update": "1" },
      },
      15000,
    )
  },
}
