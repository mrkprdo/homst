import {
  markServerReachable,
  markServerUnreachable,
  SERVER_UNREACHABLE_TITLE,
} from "@/composables/useServerReachability"

const BASE_URL = "/api/v1"

export class ServerUnreachableError extends Error {
  constructor() {
    super(SERVER_UNREACHABLE_TITLE)
    this.name = "ServerUnreachableError"
  }
}

export function isServerUnreachable(error: unknown): error is ServerUnreachableError {
  return error instanceof ServerUnreachableError
}

function isAbortError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    (error as { name?: unknown }).name === "AbortError"
  )
}

async function request<T>(url: string, options: RequestInit = {}): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${BASE_URL}${url}`, {
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...options.headers,
      },
      ...options,
    })
  } catch (error) {
    if (isAbortError(error)) throw error
    markServerUnreachable()
    throw new ServerUnreachableError()
  }

  markServerReachable()

  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.detail ?? `Request failed: ${res.status}`)
  }

  if (res.status === 204) return undefined as T
  return res.json()
}

export const api = {
  get: <T>(url: string) => request<T>(url),
  post: <T>(url: string, body?: unknown) =>
    request<T>(url, { method: "POST", body: body ? JSON.stringify(body) : undefined }),
  patch: <T>(url: string, body?: unknown) =>
    request<T>(url, { method: "PATCH", body: body ? JSON.stringify(body) : undefined }),
  put: <T>(url: string, body?: unknown) =>
    request<T>(url, { method: "PUT", body: body ? JSON.stringify(body) : undefined }),
  delete: <T>(url: string) => request<T>(url, { method: "DELETE" }),
  upload: async <T>(url: string, formData: FormData): Promise<T> => {
    let res: Response
    try {
      res = await fetch(`${BASE_URL}${url}`, {
        method: "POST",
        credentials: "include",
        body: formData,
      })
    } catch (error) {
      if (isAbortError(error)) throw error
      markServerUnreachable()
      throw new ServerUnreachableError()
    }

    markServerReachable()
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body.detail ?? `Upload failed: ${res.status}`)
    }
    return res.json() as Promise<T>
  },
}
