import type { App } from 'obsidian'
import { describe, expect, it } from 'vitest'
import { makeFakeApp } from '../../../test/fakeVault'
import type PMPlugin from '../../main'
import { DEFAULT_SETTINGS, makeTask } from '../../types'
import { ProjectStore } from '../../store/ProjectStore'
import { VaultIndex } from '../../store/VaultIndex'
import { applyToTicket, applyWithUndo, undoChange } from '../../store/chat/applyChange'
import { parseChange, type ChangeSpec } from '../../store/chat/chatChange'
import { ChatHistory } from '../../store/chat/chatHistory'
import { undoKey } from '../../store/chat/chatUndo'
import { logTicketChange } from './historyLog'

function memory() {
  const files = new Map<string, string>()
  return {
    read: async (name: string) => files.get(name) ?? null,
    write: async (name: string, data: string) => {
      files.set(name, data)
    }
  }
}

describe('the chat’s changes kept in its history', () => {
  it('keeps a ticket changed — its fields, the tickets it moved, why, the conversation —, then taken back', async () => {
    const fake = makeFakeApp({ liveMetadataCache: true })
    const app = fake.app as unknown as App
    const index = new VaultIndex(app, () => DEFAULT_SETTINGS)
    const store = new ProjectStore(app, () => DEFAULT_SETTINGS, index)
    const project = await store.createProject('Génie civil', 'Work')
    const radier = makeTask({ title: 'Radier', start: '2026-10-01', due: '2026-10-10' })
    const dalle = makeTask({ title: 'Dalle', start: '2026-10-12', due: '2026-10-14', dependencies: [radier.id] })
    await store.insertTask(project, radier)
    await store.insertTask(project, dalle)
    index.build()
    const source = JSON.stringify({ ticket: 'Radier', changes: { due: '2026-10-20' }, why: 'Retard du fournisseur.' })
    const read = parseChange(source)
    if (!('spec' in read)) throw new Error('unread')
    const spec: ChangeSpec = read.spec
    const history = new ChatHistory(memory())
    const plugin = { index, chatHistory: history, settings: DEFAULT_SETTINGS } as unknown as PMPlugin
    const { done, record } = await applyWithUndo(
      index,
      store,
      spec,
      'Radier',
      (type) => type,
      () => applyToTicket(index, store, spec as Extract<ChangeSpec, { kind: 'ticket' }>)
    )
    await logTicketChange(plugin, spec, 'Radier', source, 'Chats/Retard.md', record, done)
    const [entry] = history.list()
    expect(entry).toMatchObject({
      kind: 'ticket',
      label: 'Radier',
      why: 'Retard du fournisseur.',
      chat: 'Chats/Retard.md',
      projects: [project.filePath],
      ticket: radier.id,
      key: undoKey(source)
    })
    expect(entry.lines[0]).toBe('Radier : Due 2026-10-10 → 2026-10-20')
    expect(entry.lines.some((line) => line.startsWith('Dalle : '))).toBe(true)

    // Nothing changed — the same change asked again —: nothing kept.
    index.build()
    const again = await applyWithUndo(
      index,
      store,
      spec,
      'Radier',
      (type) => type,
      () => applyToTicket(index, store, spec as Extract<ChangeSpec, { kind: 'ticket' }>)
    )
    await logTicketChange(plugin, spec, 'Radier', source, 'Chats/Retard.md', again.record, again.done)
    expect(history.list()).toHaveLength(1)

    if (record) await undoChange(store, record)
    await history.markUndone(undoKey(source))
    expect(history.list()[0].undone).toBeTruthy()
  })
})
