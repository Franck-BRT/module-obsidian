import type { App } from 'obsidian'
import { beforeAll, describe, expect, it } from 'vitest'
import { makeFakeApp } from '../../../test/fakeVault'
import { setLocale } from '../../i18n'
import {
  agendaBlock,
  blocksIn,
  fillAgenda,
  readTemplate,
  templateFor,
  type AgendaTemplate
} from '../../store/agenda/agendaTemplate'
import { ContactBook, readContact } from '../../store/contacts'
import { ProjectStore } from '../../store/ProjectStore'
import { flattenTasks } from '../../store/TaskTreeOps'
import { DEFAULT_PRIORITIES, DEFAULT_SETTINGS, DEFAULT_STATUSES, makeDocument, makeTask, type Task } from '../../types'
import { AgendaFiller, previousMeeting, type AgendaContext } from './agendaBlocks'
import { defaultTemplates, templateNote } from './agendaDefaults'
import { linkAgendaToMeeting, withAgendaLink, writeAgenda } from './writeAgenda'
import { parseFrontmatter } from '../../store/YamlParser'

beforeAll(() => setLocale('fr'))

describe('a template', () => {
  it('knows its blocks in either language, accents, case and spacing aside', () => {
    expect(agendaBlock('retards')).toBe('late')
    expect(agendaBlock('Documents en retard')).toBe('late-documents')
    expect(agendaBlock('risques_a_revoir')).toBe('risks-to-review')
    expect(agendaBlock('réunion-précédente')).toBe('previous-meeting')
    expect(agendaBlock('critical-risks')).toBe('critical-risks')
    expect(agendaBlock('budget')).toBeNull()
  })

  it('is filled block by block, each once, what it does not know left as written', () => {
    let calls = 0
    const filled = fillAgenda('# {{ projet }} — {{date}}\n{{retards}}\n{{late}}\n{{budget}}', (block) => {
      calls++
      return `[${block}]`
    })
    expect(filled).toBe('# [project] — [date]\n[late]\n[late]\n{{budget}}')
    expect(calls).toBe(3)
    expect(blocksIn('{{retards}} {{late}} {{risques}} {{x}}')).toEqual(['late', 'risks'])
  })

  it('reads its properties, with a horizon by default, and is offered first for its kind', () => {
    const a = readTemplate('T/a.md', 'a', { name: 'Chantier', meetingKind: 'coordination', horizon: 7 }, 'x')
    const b = readTemplate('T/b.md', 'Revue', null, 'y')
    expect(a).toMatchObject({ name: 'Chantier', kinds: ['coordination'], horizon: 7 })
    expect(b).toMatchObject({ name: 'Revue', kinds: [], horizon: 14 })
    expect(templateFor([b, a], 'coordination')?.name).toBe('Chantier')
    expect(templateFor([b, a], 'financial')?.name).toBe('Revue')
    expect(templateFor([], undefined)).toBeNull()
  })
})

describe('the templates shipped', () => {
  for (const locale of ['fr', 'en'] as const) {
    it(`use only blocks that exist, and read back as written (${locale})`, () => {
      setLocale(locale)
      const all = defaultTemplates()
      expect(all.length).toBeGreaterThanOrEqual(8)
      for (const one of all) {
        const unknown = [...one.body.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)]
          .map((found) => found[1])
          .filter((name) => !agendaBlock(name))
        expect(unknown, one.name).toEqual([])
        const { frontmatter, body } = parseFrontmatter(templateNote(one))
        const read = readTemplate(`T/${one.file}.md`, one.file, frontmatter, body)
        expect(read).toMatchObject({ name: one.name, horizon: one.horizon, description: one.description })
        expect(read.kinds).toEqual(one.meetingKind ? [one.meetingKind] : [])
      }
      setLocale('fr')
    })
  }
})

const book = new ContactBook([
  readContact('People/Garonne Bâtiment.md', 'Garonne Bâtiment', { kind: 'company' }),
  readContact('People/Paul Martin.md', 'Paul Martin', { company: 'Garonne Bâtiment', role: 'Conducteur de travaux' })
])

function project(): Task[] {
  const previous = makeTask({
    title: 'Réunion de chantier n°3',
    type: 'meeting',
    meetingKind: 'coordination',
    start: '',
    due: '2026-09-25',
    subtasks: [
      makeTask({ title: 'Fournir le plan de réservations', start: '', due: '2026-09-30', assignees: ['Paul Martin'] }),
      makeTask({ title: 'Action close', start: '', status: 'done' })
    ]
  })
  previous.filePath = 'Work/B12/_tasks/Réunion 3.md'
  return [
    makeTask({ title: 'Coffrage radier', start: '2026-09-10', due: '2026-09-28', assignees: ['Paul Martin'] }),
    makeTask({ title: 'Ferraillage voiles', start: '2026-10-01', due: '2026-10-12', progress: 20 }),
    makeTask({ title: 'Plus tard', start: '', due: '2026-12-01' }),
    makeTask({
      title: 'Terrassements',
      start: '2026-09-01',
      due: '2026-09-20',
      baseline: { start: '2026-09-01', due: '2026-09-12' }
    }),
    makeTask({ title: 'Fonds de fouille reçus', type: 'milestone', start: '', due: '2026-10-08' }),
    makeTask({
      title: 'Retard béton',
      type: 'risk',
      start: '',
      due: '2026-10-10',
      assignees: ['Paul Martin'],
      risk: { probability: 3, impact: 4, mitigation: 'Seconde centrale' }
    }),
    makeTask({
      title: 'Grève',
      type: 'risk',
      start: '',
      risk: { probability: 1, impact: 2, mitigation: '' }
    }),
    makeTask({
      title: 'Choix du revêtement',
      type: 'decision',
      start: '',
      due: '2026-09-30',
      decision: { state: 'proposed', date: '', decidedBy: 'MOA', rationale: '', affects: [] }
    }),
    makeTask({
      title: 'Béton C30/37',
      type: 'decision',
      start: '',
      status: 'done',
      decision: { state: 'decided', date: '2026-09-29', decidedBy: 'COPIL', rationale: '', affects: [] }
    }),
    makeTask({
      title: 'Plan de coffrage',
      type: 'document',
      start: '',
      due: '2026-09-18',
      document: makeDocument({ reference: 'PL-002', issuer: 'Garonne Bâtiment', chases: ['2026-09-25'] })
    }),
    makeTask({
      title: 'Note de calcul',
      type: 'document',
      start: '',
      due: '2026-10-09',
      document: makeDocument({ reference: 'NDC-04', issuer: 'Garonne Bâtiment' })
    }),
    makeTask({
      title: 'Plan d’exécution',
      type: 'document',
      start: '',
      document: makeDocument({ state: 'in-review', approvers: ['Anne Leroy'] })
    }),
    previous
  ]
}

function filler(over: Partial<AgendaContext> = {}): AgendaFiller {
  const tasks = flattenTasks(project()).map((flat) => flat.task)
  const meeting = makeTask({
    title: 'Réunion de chantier n°4',
    type: 'meeting',
    meetingKind: 'coordination',
    start: '',
    due: '2026-10-02',
    startTime: '09:00',
    endTime: '10:30',
    assignees: ['Paul Martin', 'Anne Leroy']
  })
  return new AgendaFiller({
    projectTitle: 'Bâtiment B12',
    projectPath: 'Work/B12/B12.md',
    tasks,
    statuses: DEFAULT_STATUSES,
    priorities: DEFAULT_PRIORITIES,
    date: '2026-10-02',
    horizon: 14,
    meeting,
    previous: previousMeeting(tasks, '2026-10-02', 'coordination', meeting.id) ?? undefined,
    book,
    link: (path, title) => `[[${path}|${title}]]`,
    ...over
  })
}

describe('the blocks', () => {
  const f = filler()

  it('say who attends, with their role and company', () => {
    expect(f.render('attendees')).toBe('- Paul Martin — Conducteur de travaux, Garonne Bâtiment\n- Anne Leroy')
    expect(f.render('time')).toContain('09:00')
  })

  it('list the late tickets and those coming within the horizon, apart', () => {
    const late = f.render('late')
    expect(late).toContain('| Coffrage radier | Paul Martin |')
    expect(late).toContain('4 jours de retard')
    expect(late).not.toContain('Ferraillage')
    const coming = f.render('upcoming')
    expect(coming).toContain('Ferraillage voiles')
    expect(coming).not.toContain('Plus tard')
  })

  it('count late what they list late — no document nor past meeting —, and who holds it', () => {
    expect(f.render('progress')).toContain('En retard — 3 tickets ont dépassé leur date')
    const load = f.render('workload')
    expect(load).toContain('| Paul Martin | 2 | 2 |')
    expect(load).toContain('| Personne encore | 3 | 1 |')
    expect(load.indexOf('Paul Martin')).toBeLessThan(load.indexOf('Personne encore'))
  })

  it('show the slips against the baseline and the milestones', () => {
    expect(f.render('slips')).toContain('| Terrassements |')
    expect(f.render('slips')).toContain('+8 j')
    expect(f.render('milestones')).toContain('Fonds de fouille reçus')
  })

  it('weigh the risks, the critical ones apart', () => {
    expect(f.render('critical-risks')).toContain('Retard béton')
    expect(f.render('critical-risks')).not.toContain('Grève')
    expect(f.render('risks')).toContain('Grève')
    expect(f.render('risks-to-review')).toContain('Retard béton')
    expect(f.render('risk-matrix')).toContain('**2**')
  })

  it('list the decisions to take, the late ones said so, and those taken since the meeting before', () => {
    const pending = f.render('pending-decisions')
    expect(pending).toContain('| Choix du revêtement | 30 sept. (en retard) | MOA |')
    expect(pending).not.toContain('Béton')
    const taken = f.render('recent-decisions')
    expect(taken).toContain('Béton C30/37')
    expect(taken).toContain('par COPIL')
    expect(agendaBlock('décisions à prendre')).toBe('pending-decisions')
  })

  it('chase the documents by issuer, and list those expected and in review', () => {
    const late = f.render('late-documents')
    expect(late).toContain('**Garonne Bâtiment** (interlocuteur : Paul Martin)')
    expect(late).toContain('PL-002 — Plan de coffrage')
    expect(late).toContain('relancé 1×')
    expect(f.render('expected-documents')).toContain('NDC-04')
    expect(f.render('documents-in-review')).toContain('Anne Leroy')
  })

  it('follow up the previous meeting of the same kind and its open actions', () => {
    expect(f.render('previous-meeting')).toContain('[[Work/B12/_tasks/Réunion 3.md|Réunion de chantier n°3]]')
    const actions = f.render('previous-actions')
    expect(actions).toContain('Fournir le plan de réservations')
    expect(actions).not.toContain('Action close')
  })

  it('say there is nothing to report rather than leave a hole', () => {
    const bare = filler({ tasks: [], previous: undefined, meeting: undefined })
    expect(bare.render('late')).toBe('_Rien à signaler._')
    expect(bare.render('previous-meeting')).toBe('_Pas de réunion précédente de ce type._')
    expect(bare.render('attendees')).toBe('- _À compléter_')
  })
})

describe('an agenda written', () => {
  it('is a note in the project’s meetings folder, filled and linked', async () => {
    const fake = makeFakeApp({ liveMetadataCache: true })
    const app = fake.app as unknown as App
    const settings = { ...DEFAULT_SETTINGS }
    const store = new ProjectStore(app, () => settings)
    const created = await store.createProject('Bâtiment B12', 'Work')
    for (const task of project()) await store.insertTask(created, task)
    const loaded = (await store.loadProjectByPath(created.filePath)) ?? created
    const plugin = { app, settings, store } as never
    const template: AgendaTemplate = readTemplate(
      'T/Chantier.md',
      'Chantier',
      { name: 'Réunion de chantier', horizon: 14 },
      '# Réunion de chantier — {{projet}}\n\n## Retards\n{{retards}}\n\n## Points divers\n- \n'
    )
    const path = await writeAgenda(plugin, loaded, template, '2026-10-02')
    expect(path).toMatch(/_meetings\/2026-10-02 Réunion de chantier\.md$/)
    const text = await fake.vault.read(fake.vault.getAbstractFileByPath(path) as never)
    expect(text).toContain('agenda: "Réunion de chantier"')
    expect(text).toContain('# Réunion de chantier — Bâtiment B12')
    expect(text).toContain('| Coffrage radier |')
    expect(text).toContain('## Points divers')
    const again = await writeAgenda(plugin, loaded, template, '2026-10-02')
    expect(again).toMatch(/\(2\)\.md$/)
  })
})

describe('an agenda named in its meeting', () => {
  it('is linked under the agenda heading, added once, the others after it, never twice', () => {
    const first = withAgendaLink('Points à traiter.', 'Ordre du jour', '[[M/a|a]] — chantier', 'M/a.md')
    expect(first).toBe('Points à traiter.\n\n### Ordre du jour\n- [[M/a|a]] — chantier\n')
    const second = withAgendaLink(`${first}\n## Notes\nRien.`, 'Ordre du jour', '[[M/b|b]] — risques', 'M/b.md')
    expect(second).toBe(
      'Points à traiter.\n\n### Ordre du jour\n- [[M/a|a]] — chantier\n- [[M/b|b]] — risques\n\n## Notes\nRien.\n'
    )
    expect(withAgendaLink(second, 'Ordre du jour', '[[M/a|a]] — chantier', 'M/a.md')).toBe(second)
    expect(withAgendaLink('', 'Ordre du jour', '[[M/a|a]]', 'M/a.md')).toBe('### Ordre du jour\n- [[M/a|a]]\n')
  })

  it('is written in the meeting’s note and in the copy an editor holds', async () => {
    const fake = makeFakeApp({ liveMetadataCache: true })
    const app = fake.app as unknown as App
    const settings = { ...DEFAULT_SETTINGS }
    const store = new ProjectStore(app, () => settings)
    const created = await store.createProject('Bâtiment B12', 'Work')
    const meeting = makeTask({
      title: 'Réunion de chantier n°4',
      type: 'meeting',
      start: '',
      due: '2026-10-02',
      description: 'Préparer les plans.'
    })
    await store.insertTask(created, meeting)
    const loaded = (await store.loadProjectByPath(created.filePath)) ?? created
    const copy = { ...meeting }
    const words = { heading: 'Ordre du jour', line: (link: string) => `${link} — modèle « Chantier »` }
    await linkAgendaToMeeting(
      { app, settings, store } as never,
      loaded,
      copy,
      'Work/B12/_meetings/2026-10-02 Chantier.md',
      words
    )
    expect(copy.description).toContain(
      '### Ordre du jour\n- [[Work/B12/_meetings/2026-10-02 Chantier|2026-10-02 Chantier]] — modèle « Chantier »'
    )
    const reread = (await store.loadProjectByPath(created.filePath))?.tasks.find((one) => one.id === meeting.id)
    expect(reread?.description).toContain('Préparer les plans.')
    expect(reread?.description).toContain('[[Work/B12/_meetings/2026-10-02 Chantier|2026-10-02 Chantier]]')
  })
})

describe('a project’s agendas', () => {
  it('stand held before today, coming within the rolling week, in preparation after', async () => {
    const { agendaState } = await import('../../store/agenda/agendaList')
    expect(agendaState('2026-10-01', '2026-10-02')).toBe('held')
    expect(agendaState('2026-10-02', '2026-10-02')).toBe('coming')
    expect(agendaState('2026-10-09', '2026-10-02')).toBe('coming')
    expect(agendaState('2026-10-10', '2026-10-02')).toBe('preparing')
    expect(agendaState('', '2026-10-02')).toBe('preparing')
  })

  it('are found by the project they link, wherever their notes are, and sorted by state', async () => {
    const { agendasByState } = await import('../../store/agenda/agendaList')
    const fake = makeFakeApp({ liveMetadataCache: true })
    const app = fake.app as unknown as App
    const settings = { ...DEFAULT_SETTINGS }
    const store = new ProjectStore(app, () => settings)
    const b12 = await store.createProject('Bâtiment B12', 'Work')
    const other = await store.createProject('Autre', 'Work')
    const template = readTemplate('T/x.md', 'Chantier', { name: 'Réunion de chantier' }, '# {{projet}}')
    const plugin = { app, settings, store } as never
    await writeAgenda(plugin, b12, template, '2026-09-25')
    await writeAgenda(plugin, b12, template, '2026-10-05')
    await writeAgenda(plugin, b12, template, '2026-11-20')
    await writeAgenda(plugin, other, template, '2026-10-05')
    await fake.vault.create('Notes/Une note.md', '---\ntitle: rien\n---\n')
    const { projectAgendas } = await import('./projectAgendas')
    const found = projectAgendas(app, b12.filePath)
    expect(found).toHaveLength(3)
    expect(found[0]).toMatchObject({ template: 'Réunion de chantier' })
    const groups = agendasByState(found, '2026-10-02')
    expect(groups.held.map((note) => note.date)).toEqual(['2026-09-25'])
    expect(groups.coming.map((note) => note.date)).toEqual(['2026-10-05'])
    expect(groups.preparing.map((note) => note.date)).toEqual(['2026-11-20'])
  })
})
