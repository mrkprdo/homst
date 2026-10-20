export interface ReminderOption {
  /** Select value as a string; "" means no reminder */
  value: string
  label: string
}

export const REMINDER_OPTIONS: ReminderOption[] = [
  { value: "",     label: "No reminder" },
  { value: "0",    label: "At start time" },
  { value: "5",    label: "5 minutes before" },
  { value: "10",   label: "10 minutes before" },
  { value: "30",   label: "30 minutes before" },
  { value: "60",   label: "1 hour before" },
  { value: "120",  label: "2 hours before" },
  { value: "1440", label: "1 day before" },
]

/** Human label for a stored reminder offset. */
export function reminderLabel(minutes: number | null | undefined): string | null {
  if (minutes == null) return null
  const option = REMINDER_OPTIONS.find(o => o.value === String(minutes))
  if (option) return option.label
  return minutes >= 1440 ? `${Math.round(minutes / 1440)} days before` : `${minutes} minutes before`
}

/** Parse a select value into the API payload ("" → null). */
export function reminderMinutesFromValue(value: string): number | null {
  return value === "" ? null : Number(value)
}
