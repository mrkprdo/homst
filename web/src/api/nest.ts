import { api } from "./client"

export interface NestRoom {
  id: string
  name: string
  room: string | null
  temperatureC: number
  humidity: number | null
  kind: "thermostat" | "sensor"
  online: boolean
  /** This sensor is the one the thermostat currently follows. */
  active: boolean
}

export interface NestTemperatures {
  configured: boolean
  authType: "google" | "nest" | null
  connected: boolean
  rooms: NestRoom[]
  updatedAt: string | null
  error: string | null
}

export interface NestGoogleCredentials {
  account_type: "google"
  issue_token: string
  cookies: string
}

export interface NestAccountCredentials {
  account_type: "nest"
  access_token: string
}

export const nestApi = {
  getTemperatures(refresh = false): Promise<NestTemperatures> {
    return api.get<NestTemperatures>(
      `/nest/temperatures${refresh ? "?refresh=true" : ""}`,
    ) as Promise<NestTemperatures>
  },

  saveCredentials(
    credentials: NestGoogleCredentials | NestAccountCredentials,
  ): Promise<NestTemperatures> {
    return api.post<NestTemperatures>("/nest/credentials", credentials) as Promise<NestTemperatures>
  },

  clearCredentials(): Promise<{ message: string }> {
    return api.delete<{ message: string }>("/nest/credentials")
  },
}
