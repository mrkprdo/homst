/**
 * Last known household-complete flag.
 *
 * The router and App.vue both need to know whether to show onboarding. When
 * the phone opens HOMST away from the LAN, the settings request fails; keeping
 * the last successful answer lets the cached PWA render its offline views
 * instead of bouncing to the onboarding screen.
 */
export const HOUSEHOLD_COMPLETE_KEY = "homst-household-complete"

export function readHouseholdComplete(): boolean {
  try {
    return localStorage.getItem(HOUSEHOLD_COMPLETE_KEY) === "true"
  } catch {
    return false
  }
}

export function writeHouseholdComplete(complete: boolean): void {
  try {
    localStorage.setItem(HOUSEHOLD_COMPLETE_KEY, String(complete))
  } catch {
    // Storage can be unavailable in private mode; the in-memory state still works.
  }
}
