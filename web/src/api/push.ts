import { api } from "./client"

export interface PushSubscriptionKeys {
  p256dh: string
  auth: string
}

export interface PushSubscribePayload {
  endpoint: string
  keys: PushSubscriptionKeys
  user_agent?: string
}

export const pushApi = {
  vapidPublicKey: () => api.get<{ key: string }>("/push/vapid-public-key"),

  subscribe: (payload: PushSubscribePayload) =>
    api.post<{ message: string }>("/push/subscribe", payload),

  unsubscribe: (endpoint: string) =>
    api.post<{ message: string }>("/push/unsubscribe", { endpoint }),
}
