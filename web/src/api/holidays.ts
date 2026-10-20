import { api } from "./client"

export interface Holiday {
  id: string
  household_id: string
  date: string
  name: string
  local_name: string | null
  country_code: string
  province: string | null
  created_at: string
}

export interface HolidaySyncResponse {
  message: string
}

export const holidaysApi = {
  sync: (countryCode: string, province?: string) =>
    api.post<HolidaySyncResponse>("/holidays/sync", {
      country_code: countryCode,
      province: province || null,
    }),

  list: () => api.get<Holiday[]>("/holidays"),
}
