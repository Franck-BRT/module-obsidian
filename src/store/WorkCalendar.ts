import { Temporal } from '../dates'

/**
 * Which days work can land on. Scheduling reads dates through this so a dependent
 * never starts on a Sunday or a public holiday.
 *
 * The default treats every day as a working day, which makes every function here
 * agree exactly with plain calendar arithmetic. That keeps the feature opt-in:
 * turning it off has to leave existing plans untouched.
 */
export interface WorkCalendar {
  /** ISO weekday numbers that count as working: 1 is Monday, 7 is Sunday. */
  workingWeekdays: ReadonlySet<number>
  /** Extra non-working dates as YYYY-MM-DD, for public holidays and shutdowns. */
  holidays: ReadonlySet<string>
}

export const ALL_DAYS: WorkCalendar = {
  workingWeekdays: new Set([1, 2, 3, 4, 5, 6, 7]),
  holidays: new Set()
}

export const WEEKDAY_LABELS: Record<number, string> = {
  1: 'Monday',
  2: 'Tuesday',
  3: 'Wednesday',
  4: 'Thursday',
  5: 'Friday',
  6: 'Saturday',
  7: 'Sunday'
}

/**
 * A calendar with no working weekday would make every search here run forever, so an
 * empty or malformed list falls back to every day working.
 */
export function makeWorkCalendar(workingWeekdays: number[], holidays: string[] = []): WorkCalendar {
  const days = new Set(workingWeekdays.filter((d) => Number.isInteger(d) && d >= 1 && d <= 7))
  if (days.size === 0) return ALL_DAYS
  return { workingWeekdays: days, holidays: new Set(holidays.filter((h) => /^\d{4}-\d{2}-\d{2}$/.test(h))) }
}

export function isAllDays(cal: WorkCalendar): boolean {
  return cal.workingWeekdays.size === 7 && cal.holidays.size === 0
}

export function isWorkingDay(cal: WorkCalendar, date: string): boolean {
  if (cal.holidays.has(date)) return false
  return cal.workingWeekdays.has(Temporal.PlainDate.from(date).dayOfWeek)
}

/** The date itself when it works, otherwise the first working day after it. */
export function alignForward(cal: WorkCalendar, date: string): string {
  let d = date
  for (let guard = 0; guard < SEARCH_LIMIT; guard++) {
    if (isWorkingDay(cal, d)) return d
    d = Temporal.PlainDate.from(d).add({ days: 1 }).toString()
  }
  return date
}

/** The first working day strictly after `date`. */
export function nextWorkingDay(cal: WorkCalendar, date: string): string {
  return alignForward(cal, Temporal.PlainDate.from(date).add({ days: 1 }).toString())
}

/** `k` working weekdays away from `from`, holidays not considered. */
function advanceWeekdays(cal: WorkCalendar, from: Temporal.PlainDate, k: number, dir: number): Temporal.PlainDate {
  const perWeek = cal.workingWeekdays.size
  // Whole weeks are exact: each holds exactly `perWeek` working weekdays.
  const fullWeeks = Math.floor(k / perWeek)
  let cursor = from.add({ days: dir * fullWeeks * 7 })
  let remaining = k - fullWeeks * perWeek
  while (remaining > 0) {
    cursor = cursor.add({ days: dir })
    if (cal.workingWeekdays.has(cursor.dayOfWeek)) remaining--
  }
  return cursor
}

/** Working-weekday holidays crossed going from `from` to `to`, endpoint included. */
function holidaysCrossed(cal: WorkCalendar, from: string, to: string, dir: number): number {
  const low = dir > 0 ? from : to
  const high = dir > 0 ? to : from
  let count = 0
  for (const holiday of cal.holidays) {
    // Half-open at the origin: standing on a holiday is not crossing it.
    if (dir > 0 ? holiday <= low || holiday > high : holiday < low || holiday >= high) continue
    if (cal.workingWeekdays.has(Temporal.PlainDate.from(holiday).dayOfWeek)) count++
  }
  return count
}

/**
 * `date` moved by `n` working days, forward or back. Non-working days along the way
 * cost nothing, so adding 1 working day to a Friday lands on the Monday.
 *
 * Done arithmetically rather than a day at a time: offsets here can span decades,
 * and a per-day walk over that is both slow and easy to cap by accident.
 */
export function addWorkingDays(cal: WorkCalendar, date: string, n: number): string {
  if (n === 0) return date
  const from = Temporal.PlainDate.from(date)
  if (isAllDays(cal)) return from.add({ days: n }).toString()

  const dir = n > 0 ? 1 : -1
  const magnitude = Math.abs(n)
  let target = magnitude
  let cursor = advanceWeekdays(cal, from, target, dir)
  // Each holiday crossed costs one more working weekday, and reaching for it can
  // cross further holidays. `target` only grows, so this settles in as many rounds
  // as there are holidays.
  for (let guard = 0; guard <= cal.holidays.size + 1; guard++) {
    const needed = magnitude + holidaysCrossed(cal, date, cursor.toString(), dir)
    const landsWell = !cal.holidays.has(cursor.toString())
    if (needed === target && landsWell) break
    target = landsWell ? needed : Math.max(needed, target + 1)
    cursor = advanceWeekdays(cal, from, target, dir)
  }
  return cursor.toString()
}

/**
 * Working days in `(a, b]`, negative when `b` is before `a`. Mirrors daysBetween, so
 * on an all-days calendar the two return the same number.
 */
export function workingDaysBetween(cal: WorkCalendar, a: string, b: string): number {
  if (a === b) return 0
  if (b < a) return -workingDaysBetween(cal, b, a)

  const from = Temporal.PlainDate.from(a)
  const total = Temporal.PlainDate.from(b).since(from, { largestUnit: 'days' }).days
  const fullWeeks = Math.floor(total / 7)
  let count = fullWeeks * cal.workingWeekdays.size
  // The days left over past the whole weeks, counted one by one.
  for (let i = fullWeeks * 7 + 1; i <= total; i++) {
    if (cal.workingWeekdays.has(from.add({ days: i }).dayOfWeek)) count++
  }
  // Holidays are few, so walking the set beats walking the range.
  for (const holiday of cal.holidays) {
    if (holiday <= a || holiday > b) continue
    if (cal.workingWeekdays.has(Temporal.PlainDate.from(holiday).dayOfWeek)) count--
  }
  return count
}

/** Enough to cross any run of holidays; stops a malformed calendar from hanging Obsidian. */
const SEARCH_LIMIT = 4000
