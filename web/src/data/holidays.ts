// Static holiday data for auto-population
// Returns events for the current + next year

export interface HolidayDef {
  date: string       // "MM-DD" format
  name: string
  type: "government" | "religious" | "cultural"
  religion?: "christian" | "jewish" | "muslim" | "hindu"
  country: string    // ISO country code, "all" = worldwide
}

const holidays: HolidayDef[] = [
  // ── US Government ──
  { date: "01-01", name: "New Year's Day", type: "government", country: "US" },
  { date: "01-20", name: "MLK Day", type: "government", country: "US" },
  { date: "02-17", name: "Presidents' Day", type: "government", country: "US" },
  { date: "05-26", name: "Memorial Day", type: "government", country: "US" },
  { date: "06-19", name: "Juneteenth", type: "government", country: "US" },
  { date: "07-04", name: "Independence Day", type: "government", country: "US" },
  { date: "09-01", name: "Labor Day", type: "government", country: "US" },
  { date: "10-13", name: "Columbus Day", type: "government", country: "US" },
  { date: "11-11", name: "Veterans Day", type: "government", country: "US" },
  { date: "11-27", name: "Thanksgiving", type: "government", country: "US" },
  { date: "12-25", name: "Christmas Day", type: "government", country: "US" },

  // ── Religious (approximate dates for common holidays) ──
  { date: "04-18", name: "Good Friday", type: "religious", religion: "christian", country: "US" },
  { date: "04-20", name: "Easter Sunday", type: "religious", religion: "christian", country: "US" },
  { date: "10-31", name: "Halloween", type: "cultural", country: "US" },
  { date: "12-24", name: "Christmas Eve", type: "religious", religion: "christian", country: "US" },
  { date: "12-31", name: "New Year's Eve", type: "cultural", country: "all" },

  // ── Valentine's / Mother's / Father's ──
  { date: "02-14", name: "Valentine's Day", type: "cultural", country: "US" },
  { date: "05-11", name: "Mother's Day", type: "cultural", country: "US" },
  { date: "06-15", name: "Father's Day", type: "cultural", country: "US" },
]

export function generateHolidayEvents(
  calendarId: string,
  options: { government: boolean; religious: boolean; country: string },
): Array<{ title: string; startAt: string; endAt: string; allDay: boolean }> {
  const year = new Date().getFullYear()
  const events: Array<{ title: string; startAt: string; endAt: string; allDay: boolean }> = []

  for (const h of holidays) {
    // Filter by type
    if (h.type === "government" && !options.government) continue
    if (h.type === "religious" && !options.religious) continue

    // Filter by country
    if (h.country !== "all" && h.country !== options.country) continue

    const [month, day] = h.date.split("-").map(Number)
    // Add for current year and next year
    for (let y = year; y <= year + 1; y++) {
      const startAt = new Date(Date.UTC(y, month! - 1, day!)).toISOString()
      events.push({
        title: h.name,
        startAt,
        endAt: startAt,
        allDay: true,
      })
    }
  }

  return events
}
