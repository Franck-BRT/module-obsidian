import { describe, expect, it } from 'vitest'
import { addDays, daysBetween } from './Scheduler'
import {
  addWorkingDays,
  ALL_DAYS,
  alignForward,
  isWorkingDay,
  makeWorkCalendar,
  nextWorkingDay,
  workingDaysBetween
} from './WorkCalendar'

const MON_FRI = makeWorkCalendar([1, 2, 3, 4, 5])
// 2026-04-03 is a Friday, 2026-04-04 a Saturday, 2026-04-06 a Monday.
const FRIDAY = '2026-04-03'
const SATURDAY = '2026-04-04'
const MONDAY = '2026-04-06'

describe('WorkCalendar on an all-days calendar', () => {
  it('agrees with plain calendar arithmetic', () => {
    for (const n of [1, 3, 7, 30, -1, -10]) {
      expect(addWorkingDays(ALL_DAYS, FRIDAY, n)).toBe(addDays(FRIDAY, n))
    }
    for (const to of ['2026-04-01', '2026-04-30', '2026-03-01']) {
      expect(workingDaysBetween(ALL_DAYS, FRIDAY, to)).toBe(daysBetween(FRIDAY, to))
    }
    expect(nextWorkingDay(ALL_DAYS, FRIDAY)).toBe(addDays(FRIDAY, 1))
  })

  it('falls back to all days when no weekday is workable', () => {
    expect(makeWorkCalendar([])).toBe(ALL_DAYS)
    expect(makeWorkCalendar([0, 9, 1.5])).toBe(ALL_DAYS)
  })
})

describe('WorkCalendar on a Monday-to-Friday week', () => {
  it('knows which days work', () => {
    expect(isWorkingDay(MON_FRI, FRIDAY)).toBe(true)
    expect(isWorkingDay(MON_FRI, SATURDAY)).toBe(false)
  })

  it('steps over the weekend', () => {
    expect(nextWorkingDay(MON_FRI, FRIDAY)).toBe(MONDAY)
    expect(addWorkingDays(MON_FRI, FRIDAY, 1)).toBe(MONDAY)
    expect(addWorkingDays(MON_FRI, MONDAY, -1)).toBe(FRIDAY)
  })

  it('leaves a working day where it is when aligning', () => {
    expect(alignForward(MON_FRI, FRIDAY)).toBe(FRIDAY)
    expect(alignForward(MON_FRI, SATURDAY)).toBe(MONDAY)
  })

  it('counts only working days between two dates', () => {
    // Friday to the Monday after is one working day, not three.
    expect(workingDaysBetween(MON_FRI, FRIDAY, MONDAY)).toBe(1)
    // A full week is five.
    expect(workingDaysBetween(MON_FRI, FRIDAY, addDays(FRIDAY, 7))).toBe(5)
    expect(workingDaysBetween(MON_FRI, MONDAY, FRIDAY)).toBe(-1)
    expect(workingDaysBetween(MON_FRI, FRIDAY, FRIDAY)).toBe(0)
  })

  it('round-trips: adding n working days then counting back gives n', () => {
    for (const n of [1, 2, 5, 12, 40]) {
      expect(workingDaysBetween(MON_FRI, MONDAY, addWorkingDays(MON_FRI, MONDAY, n))).toBe(n)
    }
  })
})

describe('WorkCalendar holidays', () => {
  const withHoliday = makeWorkCalendar([1, 2, 3, 4, 5], [MONDAY])

  it('skips a holiday like a weekend', () => {
    expect(isWorkingDay(withHoliday, MONDAY)).toBe(false)
    expect(nextWorkingDay(withHoliday, FRIDAY)).toBe('2026-04-07')
    expect(workingDaysBetween(withHoliday, FRIDAY, MONDAY)).toBe(0)
  })

  it('ignores a holiday that lands on a non-working weekday', () => {
    const onSaturday = makeWorkCalendar([1, 2, 3, 4, 5], [SATURDAY])
    expect(workingDaysBetween(onSaturday, FRIDAY, MONDAY)).toBe(workingDaysBetween(MON_FRI, FRIDAY, MONDAY))
  })

  it('drops malformed holiday entries', () => {
    expect(makeWorkCalendar([1, 2, 3, 4, 5], ['not-a-date', MONDAY]).holidays.has(MONDAY)).toBe(true)
    expect(makeWorkCalendar([1, 2, 3, 4, 5], ['not-a-date']).holidays.size).toBe(0)
  })
})

describe('WorkCalendar over long spans', () => {
  const MON_FRI_LONG = makeWorkCalendar([1, 2, 3, 4, 5], ['2026-12-25', '2027-01-01'])

  it('handles offsets spanning decades without truncating', () => {
    const far = workingDaysBetween(MON_FRI_LONG, MONDAY, '2099-06-10')
    expect(addWorkingDays(MON_FRI_LONG, MONDAY, far)).toBe('2099-06-10')
  })

  it('stays exact against a day-by-day walk', () => {
    const walk = (start: string, n: number): string => {
      let d = start
      let left = n
      while (left > 0) {
        d = addDays(d, 1)
        if (isWorkingDay(MON_FRI_LONG, d)) left--
      }
      return d
    }
    for (const n of [1, 4, 5, 6, 190, 200, 260]) {
      expect(addWorkingDays(MON_FRI_LONG, '2026-12-18', n)).toBe(walk('2026-12-18', n))
    }
  })

  it('never lands on a holiday or a weekend', () => {
    for (let n = 1; n <= 40; n++) {
      expect(isWorkingDay(MON_FRI_LONG, addWorkingDays(MON_FRI_LONG, '2026-12-18', n))).toBe(true)
      expect(isWorkingDay(MON_FRI_LONG, addWorkingDays(MON_FRI_LONG, '2027-02-01', -n))).toBe(true)
    }
  })
})
