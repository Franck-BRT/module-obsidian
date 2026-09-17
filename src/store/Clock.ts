/**
 * Times of day on a ticket.
 *
 * The plugin has always worked in whole days, which is right for a plan and wrong for the
 * one thing a plan is full of: a meeting is at nine, not "on Tuesday". A time is kept as
 * `HH:MM` on a 24-hour clock — the shape a date input speaks, the shape that sorts as text,
 * and the shape that survives a note being edited by hand.
 *
 * Nothing here knows about time zones. A meeting happens where the project is, and a
 * project note that said 09:00 last week must still say 09:00 after a flight.
 */

/** `HH:MM`, 00:00 to 23:59. Anything else is not a time and is treated as unset. */
const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/

export function isTime(value: string): boolean {
  return TIME.test(value.trim())
}

/**
 * What a typed or stored value means, or empty when it means nothing.
 *
 * Forgiving on the way in because notes are edited by hand: `9:00`, `9h00` and `0900` are
 * all someone saying nine o'clock, and refusing them would lose what they wrote.
 */
export function parseTime(raw: string): string {
  const clean = raw.trim()
  if (!clean) return ''
  const match = /^(\d{1,2})\s*(?:[:h.]\s*(\d{1,2}))?$/.exec(clean) ?? /^(\d{2})(\d{2})$/.exec(clean)
  if (!match) return ''
  const hours = Number(match[1])
  const minutes = match[2] === undefined ? 0 : Number(match[2])
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return ''
  if (hours > 23 || minutes > 59) return ''
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

/** Minutes since midnight, or null when there is no time to count from. */
export function minutesOfDay(time: string): number | null {
  if (!isTime(time)) return null
  const [hours, minutes] = time.split(':')
  return Number(hours) * 60 + Number(minutes)
}

/**
 * How long a meeting runs, in minutes.
 *
 * Null when either end is missing, and null when the end is not after the start: a
 * meeting that ends before it begins is a typo, and inventing a negative or overnight
 * duration from it would bury the typo instead of showing it.
 */
export function minutesBetween(from: string, to: string): number | null {
  const start = minutesOfDay(from)
  const end = minutesOfDay(to)
  if (start === null || end === null) return null
  return end > start ? end - start : null
}

/** `1 h 30`, `45 min`, `2 h` — the way a duration is said, not `1.5`. */
export function formatDuration(minutes: number, labels: { hours: string; minutes: string }): string {
  if (minutes <= 0) return ''
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (!hours) return `${rest} ${labels.minutes}`
  return rest ? `${hours} ${labels.hours} ${String(rest).padStart(2, '0')}` : `${hours} ${labels.hours}`
}

/**
 * The hours a ticket shows next to its date: `09:00 – 10:30`, or one end alone.
 *
 * An end with no start is kept rather than dropped — "before 17:00" is a real thing to
 * say about a deadline, and a form that silently discarded half of what was typed would
 * be worse than one that shows it.
 */
export function formatTimeRange(from: string, to: string): string {
  const start = isTime(from) ? from : ''
  const end = isTime(to) ? to : ''
  if (start && end) return `${start} – ${end}`
  return start || end
}
