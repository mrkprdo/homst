import { api } from "./client"

export interface TestNotificationPayload {
  channels?: Array<"hud" | "push">
}

export interface TestNotificationResult {
  results: Record<string, string>
}

export const notificationsApi = {
  sendTest: (payload: TestNotificationPayload = {}) =>
    api.post<TestNotificationResult>("/notifications/test", payload),
}
