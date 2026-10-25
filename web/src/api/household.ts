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
  /** Server-resolved day/night state while `theme` is "auto". */
  autoThemeDark?: boolean
  /** Today's sunrise/sunset (ISO 8601) while `theme` is "auto". */
  autoSunrise?: string
  autoSunset?: string
  widgetLayout?: WidgetDef[]
  notifications?: NotificationPreferences
  music?: MusicPreferences
  updates?: UpdatePreferences
}

/** Now-playing display choices, shared by every screen in the household. */
export interface MusicPreferences {
  lyrics?: boolean
  background?: boolean
  backgroundSpin?: boolean
  cardSpin?: boolean
}

export interface NotificationPreferences {
  hud?: boolean
  push?: boolean
  defaultReminderMinutes?: number | null
}

export interface UpdatePreferences {
  enabled: boolean
  checkIntervalMinutes: number
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
