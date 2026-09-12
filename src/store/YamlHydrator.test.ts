import { describe, expect, it } from 'vitest'
import { VIEW_MODES } from '../types'
import { hydrateSavedViews } from './YamlHydrator'

/**
 * A saved view names the view it was saved from, in hand-editable frontmatter. The
 * reader has to recognise every view the switcher offers — a view it does not know is
 * silently dropped, and the saved view quietly opens somewhere else.
 */
describe('reading a saved view back', () => {
  it('recognises every view the switcher offers, this release’s included', () => {
    const raw = VIEW_MODES.map((mode) => ({ id: mode, name: mode, viewMode: mode, sortKey: 'status', sortDir: 'asc' }))
    expect(hydrateSavedViews(raw).map((view) => view.viewMode)).toEqual([...VIEW_MODES])
  })

  it('drops a view mode it does not know rather than trusting the file', () => {
    const [view] = hydrateSavedViews([{ id: 'a', name: 'a', viewMode: 'telepathy' }])
    expect(view?.viewMode).toBeUndefined()
  })
})
