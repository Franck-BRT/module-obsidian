import type { App } from 'obsidian'
import { beforeEach, describe, expect, it } from 'vitest'
import { makeFakeApp, type FakeVault } from '../../../test/fakeVault'
import { DEFAULT_SETTINGS, type PMSettings } from '../../types'
import { VaultIndex } from '../VaultIndex'
import { setText, textOf } from './Requirement'
import { RequirementStore } from './RequirementStore'
import { exportFileName, ReqPorter } from './ReqPorter'
import { planCsvImport, readCsvTable } from './reqCsv'

describe('ReqPorter', () => {
  let vault: FakeVault
  let app: App
  let index: VaultIndex
  let settings: PMSettings
  let store: RequirementStore
  let porter: ReqPorter

  beforeEach(() => {
    const fake = makeFakeApp({ liveMetadataCache: true })
    vault = fake.vault
    app = fake.app as unknown as App
    settings = structuredClone(DEFAULT_SETTINGS)
    index = new VaultIndex(app, () => settings)
    store = new RequirementStore(
      app,
      () => settings.requirements,
      () => Promise.resolve(),
      index
    )
    porter = new ReqPorter(app, store, index, () => settings.requirements.folder)
  })

  const planFor = (csv: string) => planCsvImport(readCsvTable(csv).rows, index.requirementRefs())

  it('creates what the plan said it would create', async () => {
    const outcome = await porter.applyCsvPlan(
      planFor('id;title;text.fr\nREQ-EXT-0042;Trappe;La trappe doit ouvrir.\n'),
      'franck'
    )
    expect(outcome.created).toEqual(['REQ-EXT-0042'])
    index.build()
    expect(index.requirementById('REQ-EXT-0042')?.text.fr.body).toBe('La trappe doit ouvrir.')
  })

  // Minting onto a number an imported file already used would point every reference in
  // the supplier's documents at something else.
  it('carries the counter past an identifier the file brought', async () => {
    await porter.applyCsvPlan(planFor('id;category;text.fr\nREQ-SYS-0042;SYS;Importée.\n'), 'franck')
    expect(settings.requirements.counters.SYS).toBe(42)
    index.build()
    const next = await store.create({ category: 'SYS' })
    expect(next?.id).toBe('REQ-SYS-0043')
  })

  it('leaves its own counters alone for a file numbered under somebody else scheme', async () => {
    await porter.applyCsvPlan(planFor('id;category;text.fr\nEXT-SYS-9000;SYS;Importée.\n'), 'franck')
    expect(settings.requirements.counters.SYS).toBeUndefined()
  })

  it('mints an identifier only where the file gave none', async () => {
    await porter.applyCsvPlan(planFor('title;category;text.fr\nSans id;SYS;Une exigence.\n'), 'franck')
    index.build()
    expect(index.requirementRefs()[0].id).toBe('REQ-SYS-0001')
  })

  it('updates what it said it would update, and touches nothing else', async () => {
    const created = await store.create({ title: 'Trappe', category: 'SYS' })
    const path = created?.filePath ?? ''
    await store.save(path, (requirement) => setText(requirement, 'fr', 'Version un.', 'a'))
    index.build()

    const outcome = await porter.applyCsvPlan(planFor(`id;text.fr\n${created?.id};Version deux.\n`), 'franck')
    expect(outcome.updated).toEqual([created?.id])
    expect(textOf((await store.load(path)) as never, 'fr')?.body).toBe('Version deux.')
  })

  // A library updated from a spreadsheet must not quietly stop knowing what is out of date.
  it('bumps the revision on an imported wording, as a typed one does', async () => {
    const created = await store.create({ category: 'SYS' })
    const path = created?.filePath ?? ''
    await store.save(path, (requirement) => setText(requirement, 'fr', 'Version un.', 'a'))
    await store.save(path, (requirement) => setText(requirement, 'en', 'Version one.', 'a'))
    index.build()

    await porter.applyCsvPlan(planFor(`id;text.fr\n${created?.id};Version deux.\n`), 'franck')
    const reloaded = await store.load(path)
    expect(reloaded?.rev).toBe(2)
    expect(reloaded?.text.en.fromRev).toBe(1)
  })

  // A spreadsheet carries every wording on the row, changed or not. The one nobody touched
  // must come back exactly as it went: a machine translation that merely passed through
  // Excel has not been read by anybody.
  it('leaves a wording the file carried unchanged exactly as it was', async () => {
    const created = await store.create({ category: 'SYS' })
    const path = created?.filePath ?? ''
    await store.save(path, (requirement) => setText(requirement, 'fr', 'Source.', 'a'))
    await store.save(path, (requirement) => setText(requirement, 'en', 'Machine.', 'llm', 'machine'))
    index.build()
    const before = await store.load(path)

    await porter.applyCsvPlan(
      planFor(`id;status;text.fr;text.en\n${created?.id};approved;Source.;Machine.\n`),
      'franck'
    )
    const after = await store.load(path)
    expect(after?.status).toBe('approved')
    expect(after?.text).toEqual(before?.text)
    expect(after?.rev).toBe(before?.rev)
  })

  it('does nothing at all about a row the plan called unchanged', async () => {
    const created = await store.create({ title: 'Trappe', category: 'SYS' })
    const path = created?.filePath ?? ''
    await store.save(path, (requirement) => setText(requirement, 'fr', 'Stable.', 'a'))
    index.build()
    vault.resetCounts()

    const outcome = await porter.applyCsvPlan(planFor(`id;title;text.fr\n${created?.id};Trappe;Stable.\n`), 'franck')
    expect(outcome).toEqual({ created: [], updated: [], failed: [] })
    expect(vault.modifyCount.size).toBe(0)
  })

  it('skips a row the plan refused rather than attempting it', async () => {
    const outcome = await porter.applyCsvPlan(planFor('id;status\nREQ-A-0001;draft\n'), 'franck')
    expect(outcome).toEqual({ created: [], updated: [], failed: [] })
  })

  it('carries the links a file brings', async () => {
    await porter.applyCsvPlan(planFor('id;text.fr\nREQ-A-0001;Base.\n'), 'franck')
    index.build()
    await porter.applyCsvPlan(planFor('id;text.fr;links\nREQ-A-0002;Dérivée.;derives-from:REQ-A-0001\n'), 'franck')
    index.build()
    expect(index.requirementById('REQ-A-0002')?.links).toEqual([{ kind: 'derives-from', to: 'REQ-A-0001' }])
  })

  describe('writing an export', () => {
    it('puts it beside the library, where it can be found again', async () => {
      const path = await porter.writeExport('Bibliothèque.csv', 'id;title\n')
      expect(path).toBe('Requirements/_exports/Bibliothèque.csv')
      expect(vault.contentAt(path)).toBe('id;title\n')
    })

    // A folder of Export-1, Export-2, Export-3 helps nobody.
    it('overwrites the export of the same name rather than numbering it', async () => {
      await porter.writeExport('Bibliothèque.csv', 'premier')
      const path = await porter.writeExport('Bibliothèque.csv', 'second')
      expect(vault.contentAt(path)).toBe('second')
    })
  })
})

describe('exportFileName', () => {
  it('says what it holds and when it was taken', () => {
    expect(exportFileName('Exigences', 'csv', new Date('2026-03-14T10:00:00Z'))).toBe('Exigences 2026-03-14.csv')
  })
})
