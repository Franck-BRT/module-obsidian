import type { App } from 'obsidian'
import { beforeAll, describe, expect, it } from 'vitest'
import { makeFakeApp } from '../../../test/fakeVault'
import { setLocale } from '../../i18n'
import { DEFAULT_SETTINGS, makeDocument, makeTask } from '../../types'
import { ProjectStore } from '../../store/ProjectStore'
import { saveVisa } from './visaRun'

beforeAll(() => setLocale('fr'))

describe('a visa sheet signed', () => {
  it('is kept with the project as a note, a Word and a PDF, and enters the visa circuit', async () => {
    const fake = makeFakeApp({ liveMetadataCache: true })
    const app = fake.app as unknown as App
    const store = new ProjectStore(app, () => DEFAULT_SETTINGS)
    const project = await store.createProject('Bâtiment B12', 'Work')
    const task = makeTask({
      title: 'Note de calcul radier',
      type: 'document',
      start: '',
      document: makeDocument({
        state: 'in-review',
        file: 'Work/Bâtiment B12/NDC-04.pdf',
        reference: 'NDC-04',
        issue: 'B',
        approvers: ['Anne Leroy', 'Paul Martin']
      })
    })
    await store.insertTask(project, task)
    const plugin = { app, store, settings: DEFAULT_SETTINGS } as never
    const path = await saveVisa(
      plugin,
      project,
      task,
      {
        verdict: 'observations',
        summary: 'Enrobage à reprendre.',
        observations: [
          { article: '§ 2.3', observation: 'Enrobage 30 mm < 40 mm.', severity: 'major', source: 'CCTP 3.4' }
        ]
      },
      {
        project: project.title,
        document: { title: task.title, reference: 'NDC-04', issue: 'B', issuer: '', file: 'NDC-04.pdf' },
        reviewer: 'Anne Leroy',
        date: '2026-10-02',
        references: ['CCTP Lot 02'],
        requirements: []
      },
      true,
      async () => {}
    )
    expect(path).toBe('Work/Bâtiment B12/Visas/Fiche de visa NDC-04 indice B 2026-10-02.md')
    const files = fake.vault.getFiles().map((file) => file.path)
    expect(files).toContain('Work/Bâtiment B12/Visas/Fiche de visa NDC-04 indice B 2026-10-02.pdf')
    expect(files).toContain('Work/Bâtiment B12/Visas/Fiche de visa NDC-04 indice B 2026-10-02.docx')
    const reread = (await new ProjectStore(app, () => DEFAULT_SETTINGS).loadProjectByPath(project.filePath))?.tasks[0]
    expect(reread?.document?.approvals).toMatchObject([{ by: 'Anne Leroy', verdict: 'observations' }])
    expect(reread?.document?.approvals[0].note).toContain(
      '[[Work/Bâtiment B12/Visas/Fiche de visa NDC-04 indice B 2026-10-02.md|Fiche de visa]]'
    )
    // Paul has yet to sign: the document stays in review.
    expect(reread?.document?.state).toBe('in-review')
  })
})
