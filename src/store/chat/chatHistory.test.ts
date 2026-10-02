import { describe, expect, it } from 'vitest'
import { ChatHistory, recordLines, recordProjects, type HistoryWords } from './chatHistory'
import type { UndoRecord } from './chatUndo'

const WORDS: HistoryWords = {
  field: (field) => ({ due: 'échéance', start: 'début', assignees: 'personnes', parent: 'déplacé' })[field] ?? field,
  value: (_field, value) => (Array.isArray(value) ? value.join(', ') : typeof value === 'string' ? value : ''),
  created: (title) => `+ ${title}`,
  more: (count) => `… et ${count} autres`
}

const RECORD: UndoRecord = {
  at: '2026-10-02T10:00:00.000Z',
  label: 'Radier',
  changed: [
    {
      project: 'P/GC.md',
      id: 'a',
      title: 'Radier',
      before: { due: '2026-10-10', assignees: ['Anne'] },
      after: { due: '2026-10-20', assignees: ['Paul'] }
    },
    { project: 'P/EQ.md', id: 'b', title: 'Pompes', before: { parent: 'x' }, after: { parent: 'y' } }
  ],
  created: [{ project: 'P/GC.md', id: 'c', title: 'Dalle', after: {} }]
}

function memory() {
  const files = new Map<string, string>()
  return {
    files,
    read: async (name: string) => files.get(name) ?? null,
    write: async (name: string, data: string) => {
      files.set(name, data)
    }
  }
}

describe('what a change from the chat did, in words', () => {
  it('says each ticket’s fields before and after, a move by its name alone, and the tickets made', () => {
    expect(recordLines(RECORD, WORDS)).toEqual([
      'Radier : échéance 2026-10-10 → 2026-10-20 ; personnes Anne → Paul',
      'Pompes : déplacé',
      '+ Dalle'
    ])
    expect(recordProjects(RECORD)).toEqual(['P/GC.md', 'P/EQ.md'])
  })

  it('counts the tickets past a few', () => {
    const many: UndoRecord = {
      ...RECORD,
      changed: Array.from({ length: 12 }, (_, at) => ({
        project: 'P/GC.md',
        id: String(at),
        title: `T${at}`,
        before: { due: '2026-10-01' },
        after: { due: '2026-10-02' }
      })),
      created: []
    }
    const lines = recordLines(many, WORDS)
    expect(lines).toHaveLength(9)
    expect(lines[8]).toBe('… et 4 autres')
  })
})

describe('the history of the chat’s changes', () => {
  it('keeps each change, the latest first, marks one taken back, and reads them again', async () => {
    const storage = memory()
    let clock = Date.parse('2026-10-02T10:00:00Z')
    const history = new ChatHistory(storage, () => new Date((clock += 60_000)))
    let told = 0
    history.onChange(() => told++)
    const base = { kind: 'ticket' as const, lines: [], why: '', chat: 'Chats/C.md', projects: ['P/GC.md'], path: '' }
    await history.add({ ...base, label: 'Radier', key: 'k1' })
    await history.add({ ...base, label: 'Dalle', key: 'k2' })
    expect(history.list().map((one) => one.label)).toEqual(['Dalle', 'Radier'])
    await history.markUndone('k1')
    await history.markUndone('inconnue')
    expect(history.list()[1].undone).toBe('2026-10-02T10:03:00.000Z')
    expect(told).toBe(3)
    const again = new ChatHistory(storage)
    await again.ready()
    expect(again.list().map((one) => [one.label, !!one.undone])).toEqual([
      ['Dalle', false],
      ['Radier', true]
    ])
  })
})
