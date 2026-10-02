import type { App } from 'obsidian'
import { describe, expect, it } from 'vitest'
import { makeFakeApp } from '../../test/fakeVault'
import { DEFAULT_SETTINGS, makeDocument, makeTask, type DocumentMeta, type Task } from '../types'
import { ProjectStore } from './ProjectStore'
import {
  askedBy,
  asksForChase,
  awaitedDocuments,
  chaseBlock,
  chaseGroups,
  chaseMail,
  recordChase,
  type ChaseWords
} from './chasing'

const TODAY = '2026-10-02'
const doc = (title: string, due: string, meta: Partial<DocumentMeta> = {}, over: Partial<Task> = {}): Task =>
  makeTask({ title, type: 'document', start: '', due, document: makeDocument(meta), ...over })

const register = [
  doc('Plan de coffrage radier', '2026-09-20', { reference: 'PL-002', issue: 'B', issuer: 'Garonne Bâtiment' }),
  doc('Note de calcul radier', '2026-09-28', {
    reference: 'NDC-04',
    issuer: 'garonne  bâtiment',
    chases: ['2026-09-29']
  }),
  doc('PPSPS', '2026-09-30', { issuer: 'Électricité Sud' }),
  doc('Fiche technique membrane', '2026-09-25'),
  doc('Reçu', '2026-09-01', { state: 'received', issuer: 'Garonne Bâtiment' }),
  doc('Plus tard', '2026-10-20', { issuer: 'Garonne Bâtiment' }),
  doc('Archivé', '2026-09-01', { issuer: 'Garonne Bâtiment' }, { archived: true }),
  makeTask({ title: 'Une tâche', start: '', due: '2026-09-01' })
]

const words: ChaseWords = {
  date: (iso) => iso,
  subject: (project) => `Relance — ${project}`,
  greeting: 'Bonjour,',
  intro: (project) => `Pour ${project}, il manque :`,
  line: (item) =>
    [item.reference, item.title, item.issue ? `ind. ${item.issue}` : '', `attendu le ${item.due}`]
      .filter(Boolean)
      .join(' — '),
  already: (last, count) => `Déjà relancé le ${last} (${count}).`,
  ask: (date) => `Avant le ${date}, merci.`,
  closing: 'Cordialement,'
}

describe('what a project still waits for', () => {
  it('keeps the documents still expected past their date, the oldest overdue first', () => {
    const items = awaitedDocuments(register, TODAY)
    expect(items.map((item) => item.title)).toEqual([
      'Plan de coffrage radier',
      'Fiche technique membrane',
      'Note de calcul radier',
      'PPSPS'
    ])
    expect(items[0]).toMatchObject({ reference: 'PL-002', issue: 'B', daysLate: 12, chases: [] })
  })

  it('gathers them by who owes them, however the name is spelt, the unnamed last', () => {
    const groups = chaseGroups(awaitedDocuments(register, TODAY))
    expect(groups.map((group) => [group.issuer, group.items.length])).toEqual([
      ['Garonne Bâtiment', 2],
      ['Électricité Sud', 1],
      ['', 1]
    ])
    expect(groups[0]).toMatchObject({ lastChase: '2026-09-29', chaseCount: 1 })
  })
})

describe('the reminder', () => {
  it('lists what is missing, says it was chased already, and asks for a date', () => {
    const [group] = chaseGroups(awaitedDocuments(register, TODAY))
    const mail = chaseMail(group, { project: 'Bâtiment B12', askedBy: '2026-10-09' }, words)
    expect(mail.subject).toBe('Relance — Bâtiment B12')
    expect(mail.body).toContain('- PL-002 — Plan de coffrage radier — ind. B — attendu le 2026-09-20')
    expect(mail.body).toContain('- NDC-04 — Note de calcul radier — attendu le 2026-09-28')
    expect(mail.body).toContain('Déjà relancé le 2026-09-29 (1).')
    expect(mail.body).toContain('Avant le 2026-10-09, merci.')
  })

  it('says nothing of earlier reminders when there were none', () => {
    const group = chaseGroups(awaitedDocuments(register, TODAY))[1]
    expect(chaseMail(group, { project: 'B12', askedBy: '2026-10-09' }, words).body).not.toContain('Déjà')
  })

  it('asks for a working day', () => {
    expect(askedBy('2026-10-02', 7)).toBe('2026-10-09')
    // Eight days from a Friday is a Saturday: the Monday after.
    expect(askedBy('2026-10-02', 8)).toBe('2026-10-12')
    expect(askedBy('2026-10-02', 9)).toBe('2026-10-12')
  })

  it('notes a reminder once a day', () => {
    const meta = recordChase(recordChase(makeDocument(), '2026-10-02'), '2026-10-02')
    expect(meta.chases).toEqual(['2026-10-02'])
    expect(recordChase(meta, '2026-09-30').chases).toEqual(['2026-09-30', '2026-10-02'])
  })
})

describe('the chat', () => {
  it('is given the list by project and by who owes them', () => {
    const block = chaseBlock([{ title: 'B12', groups: chaseGroups(awaitedDocuments(register, TODAY)) }], {
      intro: 'À relancer :',
      project: (title) => `Projet ${title}`,
      issuer: (name) => `Émetteur : ${name}`,
      unnamed: 'Émetteur inconnu',
      late: (days) => `${days} j de retard`,
      chased: (dates) => `relancé le ${dates}`,
      never: 'jamais relancé',
      none: 'Rien.'
    })
    expect(block).toContain('### Émetteur : Garonne Bâtiment')
    expect(block).toContain(
      '- PL-002 — Plan de coffrage radier — ind. B — 2026-09-20 (12 j de retard) — jamais relancé'
    )
    expect(block).toContain('- NDC-04 — Note de calcul radier — 2026-09-28 (4 j de retard) — relancé le 2026-09-29')
    expect(block).toContain('### Émetteur inconnu')
  })

  it('knows a question asking for reminders', () => {
    expect(asksForChase('Rédige les relances des documents attendus')).toBe(true)
    expect(asksForChase('Quelles pièces manquantes ?')).toBe(true)
    expect(asksForChase('Draft reminders for the overdue documents')).toBe(true)
    expect(asksForChase('Fais le point du projet')).toBe(false)
  })
})

describe('a reminder kept on the document', () => {
  it('is written in its note and read back', async () => {
    const fake = makeFakeApp({ liveMetadataCache: true })
    const app = fake.app as unknown as App
    const store = new ProjectStore(app, () => DEFAULT_SETTINGS)
    const project = await store.createProject('Bâtiment B12', 'Work')
    const task = doc('Plan de coffrage radier', '2026-09-20', { reference: 'PL-002', issuer: 'Garonne Bâtiment' })
    await store.insertTask(project, task)
    await store.updateTask(project, task.id, {
      document: recordChase(makeDocument({ reference: 'PL-002', issuer: 'Garonne Bâtiment' }), TODAY)
    })
    const reread = await new ProjectStore(app, () => DEFAULT_SETTINGS).loadProjectByPath(project.filePath)
    const found = reread?.tasks.find((one) => one.id === task.id)
    expect(found?.document).toMatchObject({ reference: 'PL-002', chases: [TODAY] })
  })
})

describe('the questions that ask for reminders', () => {
  it('are both known, in both languages, so the list goes with them', async () => {
    const { setLocale, t } = await import('../i18n')
    for (const locale of ['fr', 'en'] as const) {
      setLocale(locale)
      expect(asksForChase(t('chat.chaseAsk', { date: '2026-10-09' }))).toBe(true)
      expect(asksForChase(t('chat.preset.chaseQ'))).toBe(true)
    }
  })
})
