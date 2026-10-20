import type { Event } from "@/composables/useEvents"

function stamp(iso: string): string {
  return iso.replace(/[-:]/g, "").replace(/\.\d+/, "").replace("Z", "Z")
}

function dateOnly(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10).replace(/-/g, "")
}

function fold(line: string): string {
  const MAX = 75
  if (line.length <= MAX) return line
  let out = ""
  while (line.length > MAX) {
    out += line.slice(0, MAX) + "\r\n "
    line = line.slice(MAX)
  }
  return out + line
}

function escape(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n")
}

export function generateIcs(ev: Event): string {
  const now = stamp(new Date().toISOString())
  const uid = ev.externalUid ?? `${ev.id}@homst`

  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//HOMST//HOMST//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    fold(`UID:${uid}`),
    `DTSTAMP:${now}`,
  ]

  if (ev.allDay) {
    lines.push(`DTSTART;VALUE=DATE:${dateOnly(ev.startAt)}`)
    const endDate = ev.endAt
      ? new Date(new Date(ev.endAt).getTime() + 86400000)
      : new Date(new Date(ev.startAt).getTime() + 86400000)
    lines.push(`DTEND;VALUE=DATE:${endDate.toISOString().slice(0, 10).replace(/-/g, "")}`)
  } else {
    lines.push(`DTSTART:${stamp(ev.startAt)}`)
    if (ev.endAt) lines.push(`DTEND:${stamp(ev.endAt)}`)
  }

  lines.push(fold(`SUMMARY:${escape(ev.title)}`))
  if (ev.description) lines.push(fold(`DESCRIPTION:${escape(ev.description)}`))

  lines.push("END:VEVENT", "END:VCALENDAR")

  return lines.join("\r\n") + "\r\n"
}

export function downloadIcs(ev: Event): void {
  const blob = new Blob([generateIcs(ev)], { type: "text/calendar;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = `${ev.title.replace(/[^a-z0-9]/gi, "_")}.ics`
  a.click()
  URL.revokeObjectURL(url)
}
