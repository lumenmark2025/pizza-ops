const clockFormatter = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

const fullFormatter = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
})

export function toIsoNow() {
  return new Date().toISOString()
}

export function formatTime(iso: string) {
  return clockFormatter.format(new Date(iso))
}

export function formatDateTime(iso: string) {
  return fullFormatter.format(new Date(iso))
}

export function combineDateAndTime(date: string, time: string) {
  return new Date(`${date}T${time}:00`).toISOString()
}

export function addMinutes(iso: string, minutes: number) {
  return new Date(new Date(iso).getTime() + minutes * 60_000).toISOString()
}

export function isAfterOrEqual(a: string, b: string) {
  return new Date(a).getTime() >= new Date(b).getTime()
}
