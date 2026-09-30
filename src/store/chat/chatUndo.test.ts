import { describe, expect, it } from 'vitest'
import { makeTask, type Project } from '../../types'
import { sameValue, snapshot, undoKey, UndoLog, undoPlan, undoRecord, type UndoRecord } from './chatUndo'

function project(path: string, tasks: ReturnType<typeof makeTask>[]): Project {
  return { filePath: path, tasks } as unknown as Project
}

describe('what a change did', () => {
  it('keeps the fields that moved, the tickets made, and nothing when nothing moved', () => {
    const a = makeTask({ title: 'A', start: '2026-07-01', due: '2026-07-03', assignees: ['Anne'] })
    const b = makeTask({ title: 'B', start: '2026-07-06', due: '2026-07-07' })
    const before = snapshot([project('P.md', [a, b])])
    // The live tickets go on changing: the snapshot does not.
    a.due = '2026-07-10'
    a.assignees.push('Paul')
    const c = makeTask({ title: 'C' })
    const after = snapshot([project('P.md', [a, b, c])])
    expect(undoRecord(before, after, 'A', 'now')).toEqual({
      at: 'now',
      label: 'A',
      changed: [
        {
          project: 'P.md',
          id: a.id,
          title: 'A',
          before: { due: '2026-07-03', assignees: ['Anne'] },
          after: { due: '2026-07-10', assignees: ['Anne', 'Paul'] }
        }
      ],
      created: [{ project: 'P.md', id: c.id, title: 'C', after: after.get('P.md')?.get(c.id)?.state }]
    })
    expect(undoRecord(after, after, 'A', 'now')).toBeNull()
  })

  it('compares values whatever their key order, nothing and empty alike', () => {
    expect(sameValue({ a: 1, b: { c: 2 } }, { b: { c: 2 }, a: 1 })).toBe(true)
    expect(sameValue(undefined, {})).toBe(true)
    expect(sameValue(['a', 'b'], ['b', 'a'])).toBe(false)
    expect(sameValue('', undefined)).toBe(false)
  })

  it('puts back what still says what the change made it say, and names the rest', () => {
    const a = makeTask({ title: 'A', due: '2026-07-10' })
    const b = makeTask({ title: 'B', due: '2026-07-20' })
    const c = makeTask({ title: 'C' })
    const record: UndoRecord = {
      at: 'now',
      label: 'A',
      changed: [
        { project: 'P.md', id: a.id, title: 'A', before: { due: '2026-07-03' }, after: { due: '2026-07-10' } },
        { project: 'P.md', id: b.id, title: 'B', before: { due: '2026-07-07' }, after: { due: '2026-07-12' } },
        { project: 'P.md', id: 'gone', title: 'Gone', before: { due: '1' }, after: { due: '2' } }
      ],
      created: [
        {
          project: 'P.md',
          id: c.id,
          title: 'C',
          after: snapshot([project('P.md', [c])])
            .get('P.md')!
            .get(c.id)!.state
        }
      ]
    }
    const tickets = new Map([a, b, c].map((task) => [task.id, task]))
    expect(undoPlan(record, (_path, id) => tickets.get(id) ?? null)).toEqual({
      restore: [{ project: 'P.md', id: a.id, patch: { due: '2026-07-03' } }],
      remove: [{ project: 'P.md', id: c.id }],
      conflicts: ['B'],
      kept: [{ project: 'P.md', id: b.id }]
    })
  })
})

describe('the changes that can be undone', () => {
  function storage() {
    const files = new Map<string, string>()
    return {
      files,
      read: (name: string) => Promise.resolve(files.get(name) ?? null),
      write: (name: string, data: string) => {
        files.set(name, data)
        return Promise.resolve()
      }
    }
  }
  const record = (label: string): UndoRecord => ({ at: 'now', label, changed: [], created: [] })

  it('finds a proposal again whatever its spacing, keeps it on disk, and forgets the oldest past its limit', async () => {
    const disk = storage()
    const log = new UndoLog(disk, 2)
    await log.set('```pm-change\n{"ticket": "A", "changes": {"due": "2026-07-10"}}\n```', record('A'))
    expect(log.get('{\n  "changes": { "due": "2026-07-10" },\n  "ticket": "A"\n}')?.label).toBe('A')
    await log.set('{"ticket": "B"}', record('B'))
    await log.set('{"ticket": "C"}', record('C'))
    const again = new UndoLog(disk, 2)
    await again.ready()
    expect(again.get('{"ticket": "A", "changes": {"due": "2026-07-10"}}')).toBeNull()
    expect(again.get('{"ticket":"C"}')?.label).toBe('C')
    await again.delete('{"ticket": "C"}')
    expect(again.get('{"ticket": "C"}')).toBeNull()
    expect(undoKey('pas du JSON')).toBe('pas du JSON')
  })

  it('starts empty when what is on disk does not read', async () => {
    const disk = storage()
    disk.files.set('chat-undo.json', '{oops')
    const log = new UndoLog(disk)
    await log.ready()
    expect(log.get('{"ticket": "A"}')).toBeNull()
  })
})
