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
  /** The VAPID public key a browser needs to create a subscription. */
  vapidPublicKey: () => api.get<{ key: string }>("/push/vapid-public-key"),

  /** Register (or refresh) a device's push subscription. */
  subscribe: (payload: PushSubscribePayload) =>
    api.post<{ message: string }>("/push/subscribe", payload),

  /** Drop a device's push subscription. */
  unsubscribe: (endpoint: string) =>
    api.post<{ message: string }>("/push/unsubscribe", { endpoint }),
}
