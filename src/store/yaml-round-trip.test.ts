import { describe, expect, it } from 'vitest'
import {
  makeCollection,
  makeDefaultFilter,
  makeProject,
  makeTask,
  type Collection,
  type Project,
  type SavedView,
  type Task
} from '../types'
import { hydrateCollection, hydrateProjectFromFrontmatter, hydrateTaskFromFile } from './YamlHydrator'
import { parseFrontmatter, projectBodyRemainder } from './YamlParser'
import {
  buildTaskFrontmatter,
  foreignFrontmatter,
  PROJECT_FRONTMATTER_KEYS,
  serializeCollection,
  serializeProject,
  serializeTask,
  TASK_FRONTMATTER_KEYS,
  taskFilePath,
  type RefWriter
} from './YamlSerializer'

/** Stands in for Obsidian: every fixture file name here is unique, so none needs its path. */
const refs: RefWriter = {
  link: (targetPath, title) => `[[${targetPath.replace(/^.*\//, '').replace(/\.md$/, '')}|${title}]]`,
  dependency: () => null
}

function roundTripTask(
  t: Task,
  project: Project = makeProject('Test', 'Projects/Test.md'),
  parent: Task | null = null
) {
  const md = serializeTask(t, project, parent, [], refs)
  const { frontmatter, body } = parseFrontmatter(md)
  if (!frontmatter) throw new Error('frontmatter missing')
  return hydrateTaskFromFile(frontmatter, body, 'Projects/Test_tasks/task.md')
}

function roundTripProject(p: Project) {
  const md = serializeProject(p, [], refs)
  const { frontmatter, body } = parseFrontmatter(md)
  if (!frontmatter) throw new Error('frontmatter missing')
  return {
    project: hydrateProjectFromFrontmatter(frontmatter, body, p.filePath, 'Test'),
    frontmatter
  }
}

describe('task round-trip', () => {
  it('preserves core scheduling and metadata fields', () => {
    const original = makeTask({
      id: 'task-1',
      title: 'Design API',
      description: 'Draft the endpoints.',
      status: 'in-progress',
      priority: 'high',
      start: '2026-04-01',
      due: '2026-04-10',
      progress: 50,
      assignees: ['Alice', 'Bob'],
      tags: ['api', 'design'],
      dependencies: ['dep-1']
    })
    const { task, subtaskIds, parentId } = roundTripTask(original)

    expect(task.id).toBe(original.id)
    expect(task.title).toBe(original.title)
    expect(task.description).toBe(original.description)
    expect(task.status).toBe(original.status)
    expect(task.priority).toBe(original.priority)
    expect(task.start).toBe(original.start)
    expect(task.due).toBe(original.due)
    expect(task.progress).toBe(original.progress)
    expect(task.assignees).toEqual(original.assignees)
    expect(task.tags).toEqual(original.tags)
    expect(task.dependencies).toEqual(original.dependencies)
    expect(subtaskIds).toEqual([])
    expect(parentId).toBeNull()
  })

  it('records subtaskIds and parentId when present', () => {
    const child = makeTask({ id: 'child-1' })
    const parent = makeTask({ id: 'parent-1', subtasks: [child] })
    const project = makeProject('Test', 'Projects/Test.md')

    const top = roundTripTask(parent, project, null)
    expect(top.subtaskIds).toEqual(['child-1'])
    expect(top.parentId).toBeNull()

    const nested = roundTripTask(child, project, parent)
    expect(nested.subtaskIds).toEqual([])
    expect(nested.parentId).toBe('parent-1')
  })

  it('preserves recurrence, timeEstimate, and timeLogs', () => {
    const original = makeTask({
      id: 'task-2',
      recurrence: { interval: 'weekly', every: 2 },
      timeEstimate: 8,
      timeLogs: [
        { date: '2026-04-01', hours: 2, note: 'setup' },
        { date: '2026-04-02', hours: 3.5, note: 'review' }
      ]
    })
    const { task } = roundTripTask(original)
    expect(task.recurrence).toEqual(original.recurrence)
    expect(task.timeEstimate).toBe(8)
    expect(task.timeLogs).toEqual(original.timeLogs)
  })

  it('preserves a milestone type and empty start', () => {
    const original = makeTask({ id: 'm-1', type: 'milestone', start: '', due: '2026-05-01' })
    const { task } = roundTripTask(original)
    expect(task.type).toBe('milestone')
    expect(task.start).toBe('')
    expect(task.due).toBe('2026-05-01')
  })

  it('preserves custom field values', () => {
    const original = makeTask({
      id: 'task-3',
      customFields: { impact: 'high', score: 42 }
    })
    const { task } = roundTripTask(original)
    expect(task.customFields).toEqual({ impact: 'high', score: 42 })
  })

  it('subtask wikilinks derive from sub.filePath, falling back to a bare slug', () => {
    const project = makeProject('P', 'Projects/P.md')
    const legacySub = makeTask({ id: 'sub-legacy', title: 'Legacy', filePath: 'Projects/P_tasks/legacy-12345678.md' })
    const newSub = makeTask({ id: 'sub-new', title: 'Fresh One' }) // no filePath yet
    const parent = makeTask({ id: 'parent', subtasks: [legacySub, newSub] })
    const md = serializeTask(parent, project, null, [], refs)
    expect(md).toContain('[[legacy-12345678|Legacy]]')
    expect(md).toContain('[[fresh-one|Fresh One]]')
  })

  it('drops auto-generated Parent wiki-link and Subtasks section from the description', () => {
    const child = makeTask({ id: 'child' })
    const parent = makeTask({ id: 'parent-x', description: 'User-written note.', subtasks: [child] })
    const { task } = roundTripTask(parent)
    expect(task.description).toBe('User-written note.')
  })

  it('defaults missing fields to safe values', () => {
    const frontmatter: Record<string, unknown> = { id: 't-x' }
    const { task } = hydrateTaskFromFile(frontmatter, '', 'path.md')
    expect(task.title).toBe('Untitled')
    expect(task.status).toBe('todo')
    expect(task.priority).toBe('medium')
    expect(task.progress).toBe(0)
    expect(task.assignees).toEqual([])
    expect(task.dependencies).toEqual([])
    expect(task.customFields).toEqual({})
  })

  it('keeps only the usable names in assignees, tags, and dependencies', () => {
    const frontmatter: Record<string, unknown> = {
      id: 't-x',
      assignees: [{ id: 'm1', name: 'John Doe' }, '[[Jane Doe]]', ''],
      tags: ['api', 2026, { name: 'design' }],
      dependencies: ['dep-1', null]
    }
    const { task } = hydrateTaskFromFile(frontmatter, '', 'path.md')
    expect(task.assignees).toEqual(['[[Jane Doe]]'])
    expect(task.tags).toEqual(['api', '2026'])
    expect(task.dependencies).toEqual(['dep-1'])
  })
})

describe('project round-trip', () => {
  it('preserves core project fields', () => {
    const p = makeProject('My Project', 'Projects/MyProject.md')
    p.description = 'A great project.'
    p.color = '#ff0000'
    p.icon = '\u{1F680}'
    p.teamMembers = ['Alice', 'Bob']

    const { project } = roundTripProject(p)
    expect(project.title).toBe('My Project')
    expect(project.description).toBe('A great project.')
    expect(project.color).toBe('#ff0000')
    expect(project.icon).toBe('\u{1F680}')
    expect(project.teamMembers).toEqual(['Alice', 'Bob'])
  })

  it('preserves saved views with filter, sortKey, and sortDir', () => {
    const p = makeProject('P', 'Projects/P.md')
    const view: SavedView = {
      id: 'v1',
      name: 'High priority',
      filter: {
        text: 'api',
        statuses: ['in-progress'],
        priorities: ['high', 'critical'],
        assignees: ['Alice'],
        tags: ['design'],
        dueDateFilter: 'overdue',
        showArchived: false
      },
      sortKey: 'due',
      sortDir: 'desc'
    }
    p.savedViews = [view]

    const { project } = roundTripProject(p)
    expect(project.savedViews).toEqual([view])
  })

  it('records taskIds in the frontmatter', () => {
    const p = makeProject('P', 'Projects/P.md')
    p.tasks = [makeTask({ id: 't-1' }), makeTask({ id: 't-2' })]
    const { frontmatter } = roundTripProject(p)
    expect(frontmatter.taskIds).toEqual(['t-1', 't-2'])
  })

  it('dedups taskIds and body links when project.tasks has the same task twice', () => {
    const p = makeProject('P', 'Projects/P.md')
    const task = makeTask({ id: 't-dup', title: 'Dup', filePath: 'Projects/P_tasks/dup-tdup.md' })
    p.tasks = [task, task]
    const md = serializeProject(p, [], refs)
    const { frontmatter } = parseFrontmatter(md)
    if (!frontmatter) throw new Error('frontmatter missing')
    expect(frontmatter.taskIds).toEqual(['[[dup-tdup|Dup]]'])
    const bulletCount = md.split('\n').filter((l) => l.startsWith('- [ ] [[dup-tdup|')).length
    expect(bulletCount).toBe(1)
  })

  it('taskFilePath returns a bare-slug path without an id suffix', () => {
    expect(taskFilePath('Bug Fix', 'Projects/P_tasks')).toBe('Projects/P_tasks/bug-fix.md')
    expect(taskFilePath('A/B:C', 'Projects/P_tasks')).toBe('Projects/P_tasks/a-b-c.md')
  })

  it('falls back to the file basename when title is missing', () => {
    const project = hydrateProjectFromFrontmatter({}, '', 'Projects/Fallback.md', 'Fallback')
    expect(project.title).toBe('Fallback')
    expect(project.id).toBe('Fallback')
  })
})

// The store passes Obsidian's live frontmatter object straight into these hydrators, so
// sharing a container reference with the input would let an edit corrupt the cache.
describe('hydration does not alias the source frontmatter', () => {
  it('copies task array and object containers', () => {
    const fm: Record<string, unknown> = {
      id: 't1',
      title: 'Task',
      assignees: ['Alice'],
      tags: ['api'],
      dependencies: ['dep-1'],
      customFields: { sprint: 'S1' },
      recurrence: { interval: 'weekly', every: 1 },
      timeLogs: [{ date: '2026-04-01', hours: 2, note: 'init' }]
    }

    const { task } = hydrateTaskFromFile(fm, '', 'Projects/P_tasks/task.md')
    const logs = task.timeLogs
    if (!logs) throw new Error('timeLogs missing')
    const srcLogs = fm.timeLogs as { hours: number }[]

    expect(task.assignees).not.toBe(fm.assignees)
    expect(task.tags).not.toBe(fm.tags)
    expect(task.dependencies).not.toBe(fm.dependencies)
    expect(task.customFields).not.toBe(fm.customFields)
    expect(task.recurrence).not.toBe(fm.recurrence)
    expect(logs).not.toBe(fm.timeLogs)
    expect(logs[0]).not.toBe(srcLogs[0])

    task.assignees.push('Bob')
    task.tags.push('design')
    task.dependencies.push('dep-2')
    task.customFields.priority = 'high'
    logs[0].hours = 99

    expect(fm.assignees).toEqual(['Alice'])
    expect(fm.tags).toEqual(['api'])
    expect(fm.dependencies).toEqual(['dep-1'])
    expect(fm.customFields).toEqual({ sprint: 'S1' })
    expect(srcLogs[0].hours).toBe(2)
  })

  it('drops team members written as mappings instead of names', () => {
    const fm: Record<string, unknown> = {
      id: 'p1',
      title: 'Project',
      teamMembers: [{ id: 'm1', name: 'John Doe' }, 'Alice', null]
    }

    const project = hydrateProjectFromFrontmatter(fm, '', 'Projects/P.md', 'P')

    expect(project.teamMembers).toEqual(['Alice'])
  })

  it('copies project array containers', () => {
    const fm: Record<string, unknown> = {
      id: 'p1',
      title: 'Project',
      customFields: [{ id: 'cf1', name: 'Sprint', type: 'text' }],
      teamMembers: ['Alice']
    }

    const project = hydrateProjectFromFrontmatter(fm, '', 'Projects/P.md', 'P')

    expect(project.customFields).not.toBe(fm.customFields)
    expect(project.teamMembers).not.toBe(fm.teamMembers)

    project.customFields.push({ id: 'cf2', name: 'Points', type: 'number' })
    project.teamMembers.push('Bob')

    expect((fm.customFields as unknown[]).length).toBe(1)
    expect(fm.teamMembers).toEqual(['Alice'])
  })
})

describe('foreign frontmatter', () => {
  it('owns every key the serializers write', () => {
    const project = makeProject('P', 'Projects/P.md')
    project.parentPath = 'Projects/Parent.md'
    project.config = { defaultView: 'kanban' }
    const task = makeTask({
      id: 't-full',
      title: 'Full',
      completed: '2026-04-01',
      recurrence: { interval: 'weekly', every: 1 },
      timeEstimate: 4,
      timeLogs: [{ date: '2026-04-01', hours: 2, note: 'init' }],
      customFields: { sprint: 'S1' }
    })

    const taskKeys = Object.keys(buildTaskFrontmatter(task, project, null, refs))
    expect(taskKeys.filter((key) => !TASK_FRONTMATTER_KEYS.has(key))).toEqual([])

    const { frontmatter } = parseFrontmatter(serializeProject(project, [], refs))
    const projectKeys = Object.keys(frontmatter ?? {})
    expect(projectKeys.filter((key) => !PROJECT_FRONTMATTER_KEYS.has(key))).toEqual([])
  })

  it('writes foreign keys after its own and reads them back unchanged', () => {
    const project = makeProject('P', 'Projects/P.md')
    const task = makeTask({ id: 't-1', title: 'Task', status: 'todo' })
    const foreign = {
      uuid: 'ext-42',
      timeEntries: [{ startTime: '2026-09-02T07:00:00', endTime: '2026-09-02T07:25:00' }]
    }

    const md = serializeTask(task, project, null, [], refs, foreign)
    const { frontmatter } = parseFrontmatter(md)
    if (!frontmatter) throw new Error('frontmatter missing')

    expect(foreignFrontmatter(frontmatter, TASK_FRONTMATTER_KEYS)).toEqual(foreign)
    expect(Object.keys(frontmatter).indexOf('uuid')).toBeGreaterThan(Object.keys(frontmatter).indexOf('updatedAt'))
    expect(hydrateTaskFromFile(frontmatter, '', 'Projects/P_tasks/task.md').task.status).toBe('todo')
  })

  it('keeps only the keys the plugin does not own', () => {
    expect(foreignFrontmatter(null, TASK_FRONTMATTER_KEYS)).toEqual({})
    expect(foreignFrontmatter({ status: 'done', uuid: 'x', tasks: [] }, PROJECT_FRONTMATTER_KEYS)).toEqual({
      status: 'done',
      uuid: 'x'
    })
  })
})

describe('project body preservation', () => {
  const icon = '\u{1F4CB}'

  /** Serialize, then work out what a reload would hand back to the next save. */
  function remainderAfterSave(p: Project, extra: string): string {
    const md = serializeProject(p, [], refs, {}, extra)
    const { frontmatter, body } = parseFrontmatter(md)
    if (!frontmatter) throw new Error('frontmatter missing')
    const reloaded = hydrateProjectFromFrontmatter(frontmatter, body, p.filePath, 'Test')
    return projectBodyRemainder(body, reloaded.icon, reloaded.title, reloaded.description)
  }

  it('keeps hand-written body content across a save', () => {
    const p = makeProject('Test', 'Projects/Test.md')
    p.description = 'The description.'
    p.tasks = [makeTask({ id: 't1', title: 'One' })]
    p.tasks[0].filePath = 'Projects/Test_tasks/one.md'

    const extra = '## Meeting notes\n\nDecided to ship on Friday.'
    expect(remainderAfterSave(p, extra)).toBe(extra)
  })

  it('survives repeated saves without duplicating or losing anything', () => {
    const p = makeProject('Test', 'Projects/Test.md')
    p.description = 'The description.'
    const extra = '## Notes\n\nSomething I wrote.'

    let carried = extra
    for (let i = 0; i < 3; i++) carried = remainderAfterSave(p, carried)
    expect(carried).toBe(extra)
  })

  it('is empty for a note holding only generated content', () => {
    const p = makeProject('Test', 'Projects/Test.md')
    p.description = 'Just a description.'
    p.tasks = [makeTask({ id: 't1', title: 'One' })]
    p.tasks[0].filePath = 'Projects/Test_tasks/one.md'
    expect(remainderAfterSave(p, '')).toBe('')
  })

  it('keeps a "## Tasks" heading the user wrote themselves', () => {
    const body = `# ${icon} Test\n\nDesc.\n\n## Tasks\n\nProse, not a generated list.`
    expect(projectBodyRemainder(body, icon, 'Test', 'Desc.')).toBe('## Tasks\n\nProse, not a generated list.')
  })

  it('keeps the whole body of a note the plugin never wrote', () => {
    const body = 'Hand-made note with no heading and no description echo.'
    expect(projectBodyRemainder(body, icon, 'Test', '')).toBe(body)
  })

  it('drops the body echo when it is the description of a note without frontmatter', () => {
    const body = 'Whole body is the description.'
    expect(projectBodyRemainder(body, icon, 'Test', body)).toBe('')
  })
})

describe('dependency options round-trip', () => {
  it('keeps the link type and lag through a save and reload', () => {
    const original = makeTask({
      id: 'task-1',
      title: 'Build',
      dependencies: ['dep-1', 'dep-2'],
      dependencyOptions: { 'dep-1': { type: 'SS', lag: 2 }, 'dep-2': { type: 'FF', lag: -1 } }
    })
    const { task } = roundTripTask(original)
    expect(task.dependencyOptions).toEqual({
      'dep-1': { type: 'SS', lag: 2 },
      'dep-2': { type: 'FF', lag: -1 }
    })
  })

  it('writes nothing for a plain finish-to-start dependency', () => {
    const original = makeTask({
      id: 'task-1',
      title: 'Build',
      dependencies: ['dep-1'],
      dependencyOptions: { 'dep-1': { type: 'FS', lag: 0 } }
    })
    const md = serializeTask(original, makeProject('Test', 'Projects/Test.md'), null, [], refs)
    expect(md).not.toContain('dependencyOptions')
    expect(roundTripTask(original).task.dependencyOptions).toBeUndefined()
  })

  it('drops options left behind by a removed dependency', () => {
    const original = makeTask({
      id: 'task-1',
      title: 'Build',
      dependencies: ['dep-1'],
      dependencyOptions: { 'dep-1': { type: 'SS', lag: 1 }, gone: { type: 'FF', lag: 3 } }
    })
    expect(roundTripTask(original).task.dependencyOptions).toEqual({ 'dep-1': { type: 'SS', lag: 1 } })
  })

  it('drops an entry naming an unknown link type', () => {
    const md = serializeTask(
      makeTask({ id: 'task-1', title: 'Build', dependencies: ['dep-1'] }),
      makeProject('Test', 'Projects/Test.md'),
      null,
      [],
      refs
    ).replace('---\n\n', '---\n\n')
    const withJunk = md.replace(
      'createdAt:',
      'dependencyOptions:\n  dep-1:\n    type: "nonsense"\n    lag: 2\ncreatedAt:'
    )
    const { frontmatter, body } = parseFrontmatter(withJunk)
    if (!frontmatter) throw new Error('frontmatter missing')
    expect(hydrateTaskFromFile(frontmatter, body, 'Projects/Test_tasks/t.md').task.dependencyOptions).toBeUndefined()
  })
})

describe('collection round-trip', () => {
  /**
   * Stands in for Obsidian's link resolver: a wikilink drops the extension on the way
   * out and gets it back on the way in, which is what the real one does.
   */
  const inner = (raw: string): string => raw.replace(/^\[\[|\]\]$/g, '').split('|')[0]
  const resolve = {
    taskId: inner,
    projectPath: (raw: string) => (inner(raw) ? `${inner(raw)}.md` : null)
  }

  function roundTrip(c: Collection): Collection {
    const md = serializeCollection(c, refs)
    const { frontmatter, body } = parseFrontmatter(md)
    if (!frontmatter) throw new Error('frontmatter missing')
    return hydrateCollection(frontmatter, body, c.filePath, 'Test', resolve)
  }

  function base(): Collection {
    return { ...makeCollection('Comité', 'Projects/Comité.md'), description: 'What we present.' }
  }

  it('preserves a hand-picked list', () => {
    const original = { ...base(), include: ['task-1', 'task-2'], exclude: ['task-3'] }
    const back = roundTrip(original)
    expect(back.include).toEqual(['task-1', 'task-2'])
    expect(back.exclude).toEqual(['task-3'])
    expect(back.title).toBe('Comité')
    expect(back.description).toBe('What we present.')
  })

  it('preserves a rule and its sources', () => {
    const original: Collection = {
      ...base(),
      sources: ['Projects/A/A.md'],
      rule: { ...makeDefaultFilter(), tags: ['comite'], priorities: ['high'], showArchived: true }
    }
    const back = roundTrip(original)
    expect(back.rule).toEqual(original.rule)
    expect(back.sources).toEqual(['Projects/A/A.md'])
  })

  it('keeps a rule-less collection rule-less, rather than inventing an empty rule', () => {
    // An empty rule would match everything; absence has to survive the trip.
    const back = roundTrip(base())
    expect(back.rule).toBeUndefined()
    expect(serializeCollection(base(), refs)).not.toContain('rule:')
  })

  it('writes no task list, so a rule’s matches never churn the note', () => {
    const md = serializeCollection({ ...base(), include: ['task-1'] }, refs)
    expect(md).not.toContain('## Tasks')
  })
})
