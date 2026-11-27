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
  }
}
