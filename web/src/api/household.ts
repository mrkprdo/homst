import { api } from "./client"

export interface WidgetDef {
  id: string
  col: number
  row: number
  w: number
  h: number
}

export interface HouseholdSettings {
  isComplete?: boolean
  houseName?: string
  address?: string
  holidayCountry?: string
  holidayProvince?: string
  lat?: number
  lon?: number
  timezone?: string
  theme?: string
  themePreset?: string
  accentColor?: string
  fontSize?: string
  warm?: boolean
  autoThemeDark?: boolean
  autoSunrise?: string
  autoSunset?: string
  widgetLayout?: WidgetDef[]
  notifications?: NotificationPreferences
  music?: MusicPreferences
  screens?: ScreenPreferences
  updates?: UpdatePreferences
  camera?: CameraSettings | null
  wifi?: WifiSettings | null
}

export interface WifiSettings {
  ssid?: string
  password?: string
  encryption?: WifiEncryption
  hidden?: boolean
}

export type WifiEncryption = "WPA" | "WEP" | "nopass"

export interface CameraSettings {
  url?: string
  username?: string
  password?: string
  passwordSet?: boolean
  rotation?: number
  streamPath?: string | null
}

export interface MusicPreferences {
  lyrics?: boolean
  lyricsOffsetMs?: number
  background?: boolean
  backgroundSpin?: boolean
  cardSpin?: boolean
}

export interface ScreenPreferences {
  carousel?: boolean
  returnHome?: boolean
  autoHideNav?: boolean
}

export interface NotificationPreferences {
  hud?: boolean
  push?: boolean
  defaultReminderMinutes?: number | null
}

export interface UpdatePreferences {
  enabled: boolean
  checkIntervalMinutes: number
  autoInstall: boolean
}

export interface HouseholdMember {
  id: string
  household_id: string
  name: string
  avatar_url: string | null
  color: string | null
  role: string
  joined_at: string
}

export const householdApi = {
  getSettings(): Promise<HouseholdSettings> {
    return api.get<HouseholdSettings>("/household/settings") as Promise<HouseholdSettings>
  },

  updateSettings(settings: Partial<HouseholdSettings>): Promise<{ message: string; settings?: HouseholdSettings }> {
    return api.patch<{ message: string; settings?: HouseholdSettings }>("/household/settings", { settings })
  },

  getMembers(): Promise<HouseholdMember[]> {
    return api.get<HouseholdMember[]>("/household/members") as Promise<HouseholdMember[]>
  },
}
