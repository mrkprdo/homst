import { bootstrapApi, type BootstrapPayload } from "@/api/bootstrap"
import { useAnnouncements } from "@/composables/useAnnouncements"
import { useEvents } from "@/composables/useEvents"
import { useMembers } from "@/composables/useMembers"
import { useSettings } from "@/composables/useSettings"
import { useTasks } from "@/composables/useTasks"
import { threeMonthRange } from "@/lib/householdRange"

export function hydrateHousehold(payload: BootstrapPayload, months: string[]) {
  const settings = useSettings()
  settings.applyHouseholdSettings(payload.settings)
  settings.photos.value = payload.photos
  useMembers().hydrate(payload.members)
  useEvents().hydrate(payload.calendars, payload.events, payload.holidays, months)
  useTasks().hydrate(payload.taskLists, payload.tasks)
  useAnnouncements().hydrate(payload.announcements)
}

let inFlight: Promise<BootstrapPayload> | null = null
let hydrated = false

export function loadHousehold(): Promise<BootstrapPayload> {
  if (!inFlight) {
    const range = threeMonthRange()
    inFlight = bootstrapApi
      .load(range.from, range.to)
      .then((payload) => {
        hydrateHousehold(payload, range.months)
        hydrated = true
        return payload
      })
      .finally(() => {
        inFlight = null
      })
  }
  return inFlight
}

export function ensureHouseholdLoaded(): Promise<BootstrapPayload | null> {
  if (hydrated) return Promise.resolve(null)
  return loadHousehold()
}

export function _resetHouseholdBootstrap() {
  inFlight = null
  hydrated = false
}
