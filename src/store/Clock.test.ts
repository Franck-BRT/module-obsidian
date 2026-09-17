import { describe, expect, it } from 'vitest'
import { formatDuration, formatTimeRange, isTime, minutesBetween, minutesOfDay, parseTime } from './Clock'

describe('what counts as a time', () => {
  it('accepts a 24-hour clock and nothing outside it', () => {
    expect(isTime('00:00')).toBe(true)
    expect(isTime('23:59')).toBe(true)
    expect(isTime('24:00')).toBe(false)
    expect(isTime('09:60')).toBe(false)
    expect(isTime('9:00')).toBe(false)
    expect(isTime('')).toBe(false)
  })
})

describe('reading a time someone typed', () => {
  it('pads the short forms a person actually writes', () => {
    expect(parseTime('9')).toBe('09:00')
    expect(parseTime('9:5')).toBe('09:05')
    expect(parseTime('9h30')).toBe('09:30')
    expect(parseTime('0900')).toBe('09:00')
    expect(parseTime(' 14:05 ')).toBe('14:05')
  })

  it('refuses what is not a time rather than guessing at it', () => {
    expect(parseTime('')).toBe('')
    expect(parseTime('demain')).toBe('')
    expect(parseTime('25:00')).toBe('')
    expect(parseTime('10:75')).toBe('')
  })
})

describe('how long a meeting runs', () => {
  it('counts the minutes between the two ends', () => {
    expect(minutesBetween('09:00', '10:30')).toBe(90)
    expect(minutesBetween('14:00', '14:45')).toBe(45)
  })

  it('says nothing when an end is missing', () => {
    expect(minutesBetween('09:00', '')).toBeNull()
    expect(minutesBetween('', '10:00')).toBeNull()
  })

  /** A typo must stay visible: an end before the start is not an overnight meeting. */
  it('refuses to invent a duration from an end that precedes the start', () => {
    expect(minutesBetween('15:00', '09:00')).toBeNull()
    expect(minutesBetween('09:00', '09:00')).toBeNull()
  })

  it('counts from midnight', () => {
    expect(minutesOfDay('00:00')).toBe(0)
    expect(minutesOfDay('09:30')).toBe(570)
    expect(minutesOfDay('nope')).toBeNull()
  })
})

describe('saying a duration and a range out loud', () => {
  const labels = { hours: 'h', minutes: 'min' }

  it('says hours and minutes the way they are said', () => {
    expect(formatDuration(90, labels)).toBe('1 h 30')
    expect(formatDuration(120, labels)).toBe('2 h')
    expect(formatDuration(45, labels)).toBe('45 min')
    expect(formatDuration(0, labels)).toBe('')
  })

  /** The leading zero is what keeps 2 h 05 from reading as 2 h 5. */
  it('pads the minutes of an hour-and-a-bit', () => {
    expect(formatDuration(125, labels)).toBe('2 h 05')
  })

  it('shows both ends, or whichever end was given', () => {
    expect(formatTimeRange('09:00', '10:30')).toBe('09:00 – 10:30')
    expect(formatTimeRange('09:00', '')).toBe('09:00')
    expect(formatTimeRange('', '17:00')).toBe('17:00')
    expect(formatTimeRange('', '')).toBe('')
  })

  it('drops an end that is not a time rather than printing it', () => {
    expect(formatTimeRange('09:00', 'bientôt')).toBe('09:00')
  })
})
