import { describe, expect, it } from 'vitest'
import { surfaceFor } from './projectSurface'

describe('where a click on a project lands', () => {
  it('follows the setting when the project says nothing', () => {
    expect(surfaceFor({ program: false, ownDefaultView: null, setting: 'overview' })).toBe('overview')
    expect(surfaceFor({ program: false, ownDefaultView: null, setting: 'tasks' })).toBe('tasks')
  })

  it('opens on the views when the project names one, whatever the setting says', () => {
    // Naming a view is how someone says "open this project there"; a global default that
    // then sent them to the project's page instead made the choice unreachable.
    expect(surfaceFor({ program: false, ownDefaultView: 'dashboard', setting: 'overview' })).toBe('tasks')
    expect(surfaceFor({ program: false, ownDefaultView: 'gantt', setting: 'overview' })).toBe('tasks')
  })

  it('sends a programme to everything it holds, whatever either of them says', () => {
    expect(surfaceFor({ program: true, ownDefaultView: null, setting: 'overview' })).toBe('subtree')
    expect(surfaceFor({ program: true, ownDefaultView: 'table', setting: 'tasks' })).toBe('subtree')
  })
})
