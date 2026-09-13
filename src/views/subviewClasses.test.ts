import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { SUBVIEW_CLASSES } from './subviewClasses'

const SOURCES = [
  'src/views/table/TableView.ts',
  'src/views/gantt/GanttView.ts',
  'src/views/KanbanView.ts',
  'src/views/library/LibraryView.ts',
  'src/views/dashboard/ProjectDashboard.ts'
]

/**
 * The list is only useful if it is complete: a class a sub-view adds and this list does
 * not name is a class nothing ever removes, and the next view inherits its layout. So
 * the list is checked against what the views actually do, not against itself.
 */
describe('the classes a sub-view leaves on the shared body', () => {
  const added = SOURCES.flatMap((path) => {
    const source = readFileSync(path, 'utf8')
    return [...source.matchAll(/container\.addClass\('(pm-[\w-]+)'\)/g)].map((match) => match[1] ?? '')
  })

  it('finds one on every sub-view, so the scan itself is working', () => {
    expect(added).toHaveLength(SOURCES.length)
  })

  it('names every one of them, so none is left behind when the view changes', () => {
    expect([...SUBVIEW_CLASSES].sort()).toEqual([...new Set(added)].sort())
  })
})
