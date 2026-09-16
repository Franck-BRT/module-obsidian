import { describe, expect, it } from 'vitest'
import { makeTask } from './types'
import { today } from './dates'

describe('the date a milestone is made with', () => {
  // A milestone marks a day; it does not span one, so its date lives in `due` and it has
  // no start at all. The editor clears the start when the type is chosen by hand — but a
  // milestone made from a menu never passes through that control, and used to be written
  // with a start and no date, which makes it stake out today in whatever lot holds it.
  it('lands in the due date, not the start', () => {
    const milestone = makeTask({ type: 'milestone' })
    expect(milestone.start).toBe('')
    expect(milestone.due).toBe(today().toString())
  })

  it('moves a start it was handed', () => {
    const milestone = makeTask({ type: 'milestone', start: '2026-05-04' })
    expect(milestone).toMatchObject({ start: '', due: '2026-05-04' })
  })

  it('leaves a milestone that already says its day alone', () => {
    expect(makeTask({ type: 'milestone', start: '', due: '2026-05-04' })).toMatchObject({
      start: '',
      due: '2026-05-04'
    })
  })

  it('keeps the due and drops the start when handed both', () => {
    expect(makeTask({ type: 'milestone', start: '2026-05-01', due: '2026-05-04' })).toMatchObject({
      start: '',
      due: '2026-05-04'
    })
  })

  it('leaves a milestone with no date at all undated', () => {
    expect(makeTask({ type: 'milestone', start: '', due: '' })).toMatchObject({ start: '', due: '' })
  })

  it('does not touch an ordinary task, which really does start today', () => {
    expect(makeTask({ title: 'x' })).toMatchObject({ start: today().toString(), due: '' })
  })
})

describe('turning a dated task into a milestone', () => {
  // The same rule from the other side: the editor cleared the start, which threw the day
  // away when the task had no due date of its own.
  it('keeps its day by moving the start to the due date', () => {
    const task = makeTask({ title: 'Revue', start: '2026-05-04', due: '' })
    const asMilestone = makeTask({ ...task, type: 'milestone' })
    expect(asMilestone).toMatchObject({ start: '', due: '2026-05-04' })
  })
})
