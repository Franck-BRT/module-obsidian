import type { App } from 'obsidian'
import { describe, expect, it } from 'vitest'
import { makeFakeApp } from '../../test/fakeVault'
import { ContactBook, contactFileName, readContact, readContacts, saveContact, type Contact } from './contacts'

const contact = (name: string, fm: Record<string, unknown>): Contact => readContact(`People/${name}.md`, name, fm)

const book = new ContactBook([
  contact('Garonne Bâtiment', { kind: 'entreprise', lots: 'GO; VRD' }),
  contact('Paul Martin', {
    company: '[[Garonne Bâtiment]]',
    fonction: 'Conducteur de travaux',
    courriel: 'p.martin@garonne.fr'
  }),
  contact('Julie Bernard', { entreprise: 'Garonne Bâtiment', role: 'Assistante' }),
  contact('Électricité Sud', { kind: 'company', email: 'contact@elec-sud.fr', aliases: ['ES'] }),
  contact('Anne Leroy', { téléphone: '06 12 34 56 78' })
])

describe('a contact read from its note', () => {
  it('reads its properties in either language', () => {
    expect(book.find('Paul Martin')).toMatchObject({
      kind: 'person',
      company: 'Garonne Bâtiment',
      role: 'Conducteur de travaux',
      email: 'p.martin@garonne.fr'
    })
    expect(book.find('Garonne Bâtiment')).toMatchObject({ kind: 'company', lots: ['GO', 'VRD'] })
    expect(book.find('Anne Leroy')?.phone).toBe('06 12 34 56 78')
  })

  it('is found by a link, an alias, or a name spelt otherwise', () => {
    expect(book.find('[[Garonne Bâtiment]]')?.name).toBe('Garonne Bâtiment')
    expect(book.find('garonne  batiment')?.name).toBe('Garonne Bâtiment')
    expect(book.find('ES')?.name).toBe('Électricité Sud')
    expect(book.find('Inconnu')).toBeNull()
  })
})

describe('reaching a contact', () => {
  it('writes to a company through its own mail, or else its people', () => {
    expect(book.emailsFor('Électricité Sud')).toEqual(['contact@elec-sud.fr'])
    expect(book.emailsFor('[[Garonne Bâtiment]]')).toEqual(['p.martin@garonne.fr'])
    expect(book.emailsFor('Paul Martin')).toEqual(['p.martin@garonne.fr'])
    expect(book.emailsFor('Anne Leroy')).toEqual([])
    expect(book.emailsFor('Inconnu')).toEqual([])
  })

  it('names who to address at a company, the one with a mail first', () => {
    expect(book.members('Garonne Bâtiment').map((one) => one.name)).toEqual(['Paul Martin', 'Julie Bernard'])
    expect(book.personFor('Garonne Bâtiment')?.name).toBe('Paul Martin')
    expect(book.personFor('Électricité Sud')).toBeNull()
  })

  it('suggests the companies first', () => {
    expect(book.names().slice(0, 2)).toEqual(['Garonne Bâtiment', 'Électricité Sud'])
  })
})

describe('a contact written', () => {
  it('is made, read back, renamed with its links, and keeps what else its note holds', async () => {
    const fake = makeFakeApp({ liveMetadataCache: true })
    const app = fake.app as unknown as App
    await saveContact(app, 'People', null, 'Garonne Bâtiment', {
      kind: 'company',
      company: '',
      role: '',
      email: 'contact@garonne.fr',
      phone: '',
      lots: ['GO']
    })
    const path = await saveContact(app, 'People', null, 'Paul Martin', {
      kind: 'person',
      company: 'Garonne Bâtiment',
      role: 'Conducteur de travaux',
      email: 'p.martin@garonne.fr',
      phone: '',
      lots: []
    })
    const file = fake.vault.getAbstractFileByPath(path)
    if (!file || !('extension' in file)) throw new Error('no note')
    await fake.vault.modify(file as never, `${await fake.vault.read(file as never)}\nNotes de chantier.\n`)
    const moved = await saveContact(app, 'People', path, 'Paul Martin-Durand', {
      kind: 'person',
      company: 'Garonne Bâtiment',
      role: 'Chef de chantier',
      email: '',
      phone: '05 61 00 00 00',
      lots: []
    })
    expect(moved).toBe('People/Paul Martin-Durand.md')
    const contacts = readContacts(app, 'People')
    expect(contacts.map((one) => one.name)).toEqual(['Garonne Bâtiment', 'Paul Martin-Durand'])
    expect(contacts[1]).toMatchObject({
      company: 'Garonne Bâtiment',
      role: 'Chef de chantier',
      email: '',
      phone: '05 61 00 00 00'
    })
    const text = await fake.vault.read(fake.vault.getAbstractFileByPath(moved) as never)
    expect(text).toContain('company: "[[Garonne Bâtiment]]"')
    expect(text).toContain('Notes de chantier.')
    expect(text).not.toContain('email')
  })

  it('takes out of a name what a file name cannot hold', () => {
    expect(contactFileName('SNC « Lot 2 » / GO')).toBe('SNC « Lot 2 » GO')
  })
})

describe('what each contact has to do with the projects', () => {
  it('counts the tickets they hold and the documents they owe, late ones apart, and the names with no contact', async () => {
    const { contactWork } = await import('./contactWork')
    const { DEFAULT_STATUSES, makeDocument, makeTask } = await import('../types')
    const tasks = [
      makeTask({ title: 'Coffrage', start: '', due: '2026-09-20', assignees: ['[[People/Paul Martin|Paul Martin]]'] }),
      makeTask({ title: 'Ferraillage', start: '', due: '2026-10-20', assignees: ['Paul Martin', 'Marc Petit'] }),
      makeTask({ title: 'Fini', start: '', due: '2026-09-01', status: 'done', assignees: ['Paul Martin'] }),
      makeTask({
        title: 'Plan de coffrage',
        type: 'document',
        start: '',
        due: '2026-09-18',
        document: makeDocument({ issuer: 'Garonne Bâtiment', chases: ['2026-09-25'] })
      }),
      makeTask({
        title: 'Note de calcul',
        type: 'document',
        start: '',
        due: '2026-10-18',
        document: makeDocument({ issuer: '[[Garonne Bâtiment]]' })
      }),
      makeTask({
        title: 'PPSPS',
        type: 'document',
        start: '',
        due: '2026-09-18',
        document: makeDocument({ issuer: 'Plomberie Ouest' })
      })
    ]
    const { byContact, unknown } = contactWork(
      book,
      [{ path: 'B12.md', title: 'B12', tasks, statuses: DEFAULT_STATUSES }],
      '2026-10-02'
    )
    const paul = byContact.get('People/Paul Martin.md')
    expect(paul?.tickets.map((one) => one.task.title)).toEqual(['Coffrage', 'Ferraillage'])
    expect(paul?.lateTickets).toBe(1)
    const garonne = byContact.get('People/Garonne Bâtiment.md')
    expect(garonne?.documents.map((one) => one.task.title)).toEqual(['Plan de coffrage', 'Note de calcul'])
    expect(garonne).toMatchObject({ lateDocuments: 1, lastChase: '2026-09-25' })
    expect(unknown).toEqual([
      { name: 'Marc Petit', issuer: false, count: 1 },
      { name: 'Plomberie Ouest', issuer: true, count: 1 }
    ])
  })
})
