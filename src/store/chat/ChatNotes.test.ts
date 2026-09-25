import type { App } from 'obsidian'
import { beforeEach, describe, expect, it } from 'vitest'
import { makeFakeApp, type FakeVault } from '../../../test/fakeVault'
import { ChatNotes } from './ChatNotes'
import type { ChatTurn } from './chatSession'

const WORDS = { user: 'Vous', assistant: 'Assistant' }
const at = (minute: number): string => new Date(2026, 8, 25, 10, minute).toISOString()
const turn = (role: ChatTurn['role'], content: string, minute: number): ChatTurn => ({ role, content, at: at(minute) })
const META = { title: 'Reformuler REQ-LOG-0002', model: 'qwen3', created: at(3) }

describe('ChatNotes', () => {
  let vault: FakeVault
  let notes: ChatNotes
  let folder: string

  beforeEach(() => {
    const fake = makeFakeApp({ liveMetadataCache: true })
    vault = fake.vault
    folder = 'Chats'
    notes = new ChatNotes(fake.app as unknown as App, () => folder)
  })

  it('writes a conversation to a note in the folder the settings name, and reads it back', async () => {
    const turns = [turn('user', 'Question', 3), turn('assistant', 'Réponse', 4)]
    const file = await notes.create(META, turns, WORDS)
    expect(file.path).toMatch(/^Chats\/2026-09-25 10h03 Reformuler REQ-LOG-0002\.md$/)
    expect((await notes.load(file)).turns).toEqual(turns)
  })

  it('never writes over another conversation that began the same minute on the same question', async () => {
    const first = await notes.create(META, [turn('user', 'Un', 3)], WORDS)
    const second = await notes.create(META, [turn('user', 'Deux', 3)], WORDS)
    expect(second.path).not.toBe(first.path)
    expect((await notes.load(first)).turns[0].content).toBe('Un')
  })

  it('adds the next exchange at the end of the note', async () => {
    const file = await notes.create(META, [turn('user', 'Q1', 3), turn('assistant', 'R1', 4)], WORDS)
    await notes.append(file.path, [turn('user', 'Q2', 5), turn('assistant', 'R2', 6)], WORDS)
    expect((await notes.load(file)).turns.map((each) => each.content)).toEqual(['Q1', 'R1', 'Q2', 'R2'])
  })

  // Deleted under the panel: the caller is told, so it can start a new note instead.
  it('says so when the note it was adding to is gone', async () => {
    expect(await notes.append('Chats/disparue.md', [turn('user', 'Q', 3)], WORDS)).toBeNull()
  })

  it('finds conversations wherever they were moved, and nothing else, latest first', async () => {
    const older = await notes.create(META, [turn('user', 'Ancienne', 3)], WORDS)
    folder = 'Projets/Alpha'
    const newer = await notes.create({ ...META, title: 'Autre' }, [turn('user', 'Récente', 3)], WORDS)
    await vault.create('Projets/Alpha/Note.md', '---\ntitle: pas une conversation\n---\n\nTexte.')
    older.stat.mtime = 1
    newer.stat.mtime = 2
    expect(notes.list().map((file) => file.path)).toEqual([newer.path, older.path])
  })
})
