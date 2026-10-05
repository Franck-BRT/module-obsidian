import { beforeAll, describe, expect, it } from 'vitest'
import { setLocale } from '../../i18n'
import { DEFAULT_STATUSES, makeDocument, makeTask, type Task } from '../../types'
import { isQuiet, isoWeek, weeklyDue, weeklyFacts, weeklySnapshot } from './weeklyFacts'
import {
  factsMarkdown,
  mailtoLink,
  recipients,
  weeklyMail,
  weeklyNote,
  weeklyRequest
} from '../../views/weekly/weeklyText'

beforeAll(() => setLocale('fr'))

const TODAY = '2026-10-12'

function project(): Task[] {
  return [
    makeTask({
      id: 'lot',
      title: 'Gros œuvre',
      type: 'phase',
      start: '',
      budget: {
        amount: 100_000,
        commitments: [{ date: '2026-10-08', label: 'Avenant 1', company: 'X', amount: 5_000 }],
        invoices: [{ date: '2026-09-01', label: 'S1', company: 'X', amount: 20_000 }]
      },
      subtasks: [
        makeTask({
          id: 'a',
          title: 'Coffrage',
          start: '2026-10-01',
          due: '2026-10-07',
          status: 'done',
          completed: '2026-10-09'
        }),
        makeTask({
          id: 'b',
          title: 'Ferraillage',
          start: '2026-10-05',
          due: '2026-10-09',
          assignees: ['Garonne Bâtiment']
        }),
        makeTask({ id: 'c', title: 'Coulage', start: '2026-10-13', due: '2026-10-16', dependencies: ['b'] }),
        makeTask({ id: 'd', title: 'Voiles', start: '2026-10-20', due: '2026-11-20' })
      ]
    }),
    makeTask({ id: 'm', title: 'Radier coulé', type: 'milestone', start: '', due: '2026-10-16' }),
    makeTask({
      id: 'doc',
      title: 'Plan de coffrage',
      type: 'document',
      start: '',
      document: makeDocument({
        reference: 'PL-002',
        versions: [{ version: 1, file: 'p.pdf', at: '2026-10-10T09:00:00.000Z', by: '', note: '' }]
      })
    })
  ]
}

describe('the weekly report', () => {
  it('knows its week, and when it is owed', () => {
    expect(isoWeek('2026-10-12')).toBe('2026-W42')
    expect(isoWeek('2027-01-01')).toBe('2026-W53')
    const settings = { weeklyReport: true, weeklyReportDone: '', weeklyReportDay: '1' }
    expect(weeklyDue(settings, '2026-10-12')).toBe(true)
    expect(weeklyDue({ ...settings, weeklyReportDone: '2026-W42' }, '2026-10-14')).toBe(false)
    expect(weeklyDue({ ...settings, weeklyReportDay: '3' }, '2026-10-13')).toBe(false)
    expect(weeklyDue({ ...settings, weeklyReport: false }, '2026-10-12')).toBe(false)
  })

  it('reads the week off the tickets, and what moved against last week’s snapshot', () => {
    const tasks = project()
    const previous = {
      taken: '2026-10-05',
      progress: 20,
      end: '2026-11-17',
      forecast: 100_000,
      dues: { d: '2026-11-17' }
    }
    const facts = weeklyFacts({ tasks, statuses: DEFAULT_STATUSES, today: TODAY, progress: 35, previous })
    expect(facts.from).toBe('2026-10-06')
    expect(facts.done.map((task) => task.title)).toEqual(['Coffrage'])
    expect(facts.late).toMatchObject([{ days: 3, fresh: true }])
    expect(facts.moved.map((one) => [one.task.title, one.days])).toEqual([['Voiles', 3]])
    expect(facts.upcoming.map((task) => task.title)).toEqual(['Coulage'])
    expect(facts.milestones.next?.title).toBe('Radier coulé')
    expect(facts.documents.received.map((task) => task.title)).toEqual(['Plan de coffrage'])
    expect(facts.budget).toMatchObject({ committed: 5_000, invoiced: 0, before: 100_000 })
    expect(facts.end).toEqual({ now: '2026-11-20', before: '2026-11-17' })
    expect(isQuiet(facts)).toBe(false)
    const snapshot = weeklySnapshot(facts, tasks, DEFAULT_STATUSES)
    expect(snapshot.dues).toMatchObject({ b: '2026-10-09', d: '2026-11-20' })
    expect(snapshot.dues.a).toBeUndefined()

    const text = factsMarkdown(facts)
    expect(text).toContain('- Avancement : 35 % (+15 points en une semaine)')
    expect(text).toContain('Fin prévue : 20 novembre 2026, repoussée de 3 jours')
    expect(text).toContain('### En retard (1)')
    expect(text).toContain('- Ferraillage (Garonne Bâtiment) — 3 jours de retard (nouveau cette semaine)')
    expect(text).toContain('- Voiles : repoussé de 3 jours, au 20 nov.')
    expect(text).toContain('- Reçu : PL-002 — Plan de coffrage')
  })

  it('says a quiet week, and drafts the mail and the note', () => {
    const quiet = weeklyFacts({ tasks: [], statuses: DEFAULT_STATUSES, today: TODAY, progress: 0 })
    expect(isQuiet(quiet)).toBe(true)
    expect(factsMarkdown(quiet)).toContain('Semaine calme')

    const facts = weeklyFacts({ tasks: project(), statuses: DEFAULT_STATUSES, today: TODAY, progress: 35 })
    const mail = weeklyMail('Bâtiment B12', facts.week, 'Le chantier a trois jours de retard.', facts)
    expect(mail.subject).toBe('Bâtiment B12 — point hebdomadaire, semaine 42')
    expect(mail.body).toContain('Le chantier a trois jours de retard.')
    expect(mail.body).toContain('Le rapport d’état détaillé est joint en PDF.')
    expect(recipients('a@x.fr; b@y.fr, pas-une-adresse')).toEqual(['a@x.fr', 'b@y.fr'])
    expect(mailtoLink(['a@x.fr'], 'S (1)', 'B')).toBe('mailto:a@x.fr?subject=S%20%281%29&body=B')

    const note = weeklyNote({
      project: { title: 'Bâtiment B12', link: '[[Work/B12|Bâtiment B12]]' },
      facts,
      synthesis: '',
      missing: 'Pas de synthèse.',
      pdf: 'Work/Rapports/r.pdf',
      to: []
    })
    expect(note).toContain('type: weekly-report')
    expect(note).toContain('week: 2026-W42')
    expect(note).toContain('# Point hebdomadaire — Bâtiment B12 — semaine 42')
    expect(note).toContain('_Pas de synthèse._')
    expect(note).toContain('[[Work/Rapports/r.pdf|Rapport d’état (PDF)]]')
    expect(note).toContain('[Ouvrir le brouillon dans la messagerie](mailto:?subject=')

    const request = weeklyRequest('m', 'B12', facts.week, 'faits', 'fr')
    expect(request.messages[0].content).toContain('Write in French.')
    expect(request.messages[1].content).toBe('# B12 — 2026-W42\n\nfaits')
  })
})
