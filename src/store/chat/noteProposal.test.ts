import { TFile, type App } from 'obsidian'
import { beforeEach, describe, expect, it } from 'vitest'
import { makeFakeApp, type FakeVault } from '../../../test/fakeVault'
import {
  appendProposal,
  appendTarget,
  holdsProposal,
  newNoteContent,
  parseNoteProposal,
  safeFolder,
  writeProposedNote,
  writtenNote
} from './noteProposal'

const BLOCK = `titre: Compte rendu réunion 12
Dossier : Work/Génie civil/CR
Étiquettes: cr, chantier
---
# Compte rendu réunion 12

- Radier décalé au 19/10.`

describe('parseNoteProposal', () => {
  it('reads the header — in either language, whatever the case and accents — then the note', () => {
    expect(parseNoteProposal(BLOCK)).toEqual({
      title: 'Compte rendu réunion 12',
      folder: 'Work/Génie civil/CR',
      append: '',
      tags: ['cr', 'chantier'],
      body: '# Compte rendu réunion 12\n\n- Radier décalé au 19/10.'
    })
    expect(parseNoteProposal('title: "Minutes"\nfolder: Notes\n---\nText')).toMatchObject({
      title: 'Minutes',
      folder: 'Notes',
      body: 'Text'
    })
  })

  it('takes a note with no header whole, titled by its first heading', () => {
    expect(parseNoteProposal('# Décision radier\n\nOn décale.')).toMatchObject({
      title: 'Décision radier',
      folder: '',
      body: '# Décision radier\n\nOn décale.'
    })
  })

  it('does not take a note’s own rule for the end of a header', () => {
    const note = '# Synthèse\n\nPremière partie.\n\n---\n\nSeconde partie.'
    expect(parseNoteProposal(note)?.body).toBe(note)
  })

  it('reads the note to add to', () => {
    expect(parseNoteProposal('ajouter à: [[Journal de chantier]]\n---\n## 29/09\nBéton coulé.')).toMatchObject({
      title: '',
      append: '[[Journal de chantier]]',
      body: '## 29/09\nBéton coulé.'
    })
  })

  it('has nothing to write without a body, or without a title or a note to add to', () => {
    expect(parseNoteProposal('titre: Vide\n---\n')).toBeNull()
    expect(parseNoteProposal('Du texte sans titre.')).toBeNull()
  })
})

describe('safeFolder', () => {
  it('keeps a folder inside the vault, each part a name a file system takes', () => {
    expect(safeFolder('/Work/../Génie civil/CR:12/')).toBe('Work/Génie civil/CR-12')
    expect(safeFolder('  ')).toBe('')
    expect(safeFolder('..\\..')).toBe('')
  })
})

describe('newNoteContent', () => {
  it('writes the tags and the conversation it came from as properties, then the note', () => {
    const proposal = parseNoteProposal(BLOCK)
    if (!proposal) throw new Error('unread')
    expect(newNoteContent(proposal, 'Chats/2026-09-29 Réunion.md')).toBe(
      '---\ntags:\n  - cr\n  - chantier\nchat: "[[Chats/2026-09-29 Réunion]]"\n---\n\n# Compte rendu réunion 12\n\n- Radier décalé au 19/10.\n'
    )
    expect(newNoteContent({ ...proposal, tags: [] }, '')).toBe(
      '# Compte rendu réunion 12\n\n- Radier décalé au 19/10.\n'
    )
  })

  it('knows a note that already holds the text, however it was wrapped', () => {
    const proposal = parseNoteProposal('# A\n\nun  deux\ntrois')
    if (!proposal) throw new Error('unread')
    expect(holdsProposal('---\nx: 1\n---\n# A\nun deux trois\n', proposal)).toBe(true)
    expect(holdsProposal('# A\nun deux', proposal)).toBe(false)
  })
})

describe('writing a proposed note', () => {
  let vault: FakeVault
  let app: App

  beforeEach(() => {
    const fake = makeFakeApp({ liveMetadataCache: true })
    vault = fake.vault
    app = fake.app as unknown as App
  })

  it('writes it in its folder, never over another note, and knows it was written', async () => {
    const proposal = parseNoteProposal(BLOCK)
    if (!proposal) throw new Error('unread')
    expect(await writtenNote(app, proposal, 'Notes')).toBeNull()
    await vault.create('Work/Génie civil/CR/Compte rendu réunion 12.md', 'Une autre note')
    const file = await writeProposedNote(app, proposal, 'Notes', '')
    expect(file.path).toBe('Work/Génie civil/CR/Compte rendu réunion 12-1.md')
    expect((await writtenNote(app, proposal, 'Notes'))?.path).toBe(file.path)
  })

  it('writes a note naming no folder in the one given for the chat’s notes, or at the root', async () => {
    const proposal = parseNoteProposal('# Décision\n\nOn décale.')
    if (!proposal) throw new Error('unread')
    expect((await writeProposedNote(app, proposal, 'Notes/Chat', '')).path).toBe('Notes/Chat/Décision.md')
    expect((await writeProposedNote(app, proposal, '', '')).path).toBe('Décision.md')
  })

  it('adds to the note it names, found as a link is', async () => {
    const journal = await vault.create('Work/Journal de chantier.md', '# Journal\n\n## 28/09\nFerraillage.\n')
    const proposal = parseNoteProposal('ajouter à: [[Journal de chantier]]\n---\n## 29/09\nBéton coulé.')
    if (!proposal) throw new Error('unread')
    const target = appendTarget(app, proposal, 'Chats/c.md')
    expect(target?.path).toBe('Work/Journal de chantier.md')
    if (!(target instanceof TFile)) throw new Error('no target')
    await appendProposal(app, target, proposal)
    expect(vault.contentAt(journal.path)).toBe('# Journal\n\n## 28/09\nFerraillage.\n\n## 29/09\nBéton coulé.\n')
    expect(appendTarget(app, { ...proposal, append: '[[Nulle part]]' }, 'Chats/c.md')).toBeNull()
  })
})
