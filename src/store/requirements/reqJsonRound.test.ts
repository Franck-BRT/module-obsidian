import type { App } from 'obsidian'
import { beforeEach, describe, expect, it } from 'vitest'
import { makeFakeApp, type FakeVault } from '../../../test/fakeVault'
import { DEFAULT_REQUIREMENT_SETTINGS, DEFAULT_SETTINGS, type RequirementSettings } from '../../types'
import { VaultIndex } from '../VaultIndex'
import { RequirementStore } from './RequirementStore'
import { ReqPorter } from './ReqPorter'
import { addLink, isStale, makeRequirement, setText, type Requirement } from './Requirement'
import { addAlias } from './reqAlias'
import { readReqJson, toReqJson } from './reqJson'
import { planJsonImport } from './reqJsonImport'
import { readReqXml, toReqXml } from './reqXml'
import { toReqif } from './reqif'
import { planReqifImport, readReqif } from './reqifRead'

/**
 * The whole way round: a library written to JSON, imported into an empty vault, read back
 * off the notes and compared with what went out. Every layer is tested on its own; this
 * is the one that catches them disagreeing.
 */
describe('a library exported to JSON and imported into an empty vault', () => {
  let vault: FakeVault
  let app: App
  let index: VaultIndex
  let settings: RequirementSettings
  let porter: ReqPorter

  beforeEach(() => {
    const fake = makeFakeApp({ liveMetadataCache: true })
    vault = fake.vault
    app = fake.app as unknown as App
    index = new VaultIndex(app, () => ({ ...DEFAULT_SETTINGS }))
    settings = structuredClone(DEFAULT_REQUIREMENT_SETTINGS)
    const store = new RequirementStore(
      app,
      () => settings,
      () => Promise.resolve(),
      index
    )
    porter = new ReqPorter(app, store, index, () => settings.folder)
  })

  /**
   * A small library holding the things a table cannot carry: a machine translation
   * nobody has read, a wording behind its source, a link the far end moved under, a
   * second name and a history.
   */
  const library = (): Requirement[] => {
    let one = makeRequirement({
      id: 'REQ-THERM-0001',
      title: 'Maintien en température',
      category: 'THERM',
      type: 'performance',
      status: 'approved',
      verification: 'test',
      rationale: 'Les cartes décrochent au-delà.',
      tags: ['soute'],
      sourceLang: 'fr',
      history: [{ rev: 1, at: '2026-09-12T08:00:00.000Z', by: 'franck', lang: 'fr', was: 'Avant.', note: 'Revue.' }]
    })
    one = setText(one, 'fr', 'La soute doit rester entre 5 °C et 30 °C.', 'franck')
    one = setText(one, 'en', 'The hold shall stay between 5 and 30 °C.', 'sidonie', 'machine')
    one = setText(one, 'fr', 'La soute doit rester entre 5 °C et 28 °C.', 'franck')
    one = addAlias(one, 'OMLX-THERM-0001')

    let two = makeRequirement({ id: 'REQ-THERM-0002', title: 'Mesure', category: 'THERM', sourceLang: 'fr' })
    two = setText(two, 'fr', 'Le calculateur doit mesurer toutes les 10 s.', 'franck')
    two = addLink(two, 'derives-from', 'REQ-THERM-0001')

    return [one, { ...two, links: two.links.map((link) => ({ ...link, suspect: true })) }].sort((a, b) =>
      a.id.localeCompare(b.id)
    )
  }

  it('writes every requirement as it was, down to what each wording knows about itself', async () => {
    const out = library()
    const plan = planJsonImport(readReqJson(toReqJson(out, { exported: '2026-09-24T10:00:00.000Z' })), [])
    expect(plan.every((row) => row.action === 'create')).toBe(true)

    const outcome = await porter.applyJsonPlan(plan)
    expect(outcome.failed).toEqual([])
    expect(outcome.created).toHaveLength(out.length)

    index.build()
    const back = index.requirementRefs().map((requirement) => ({ ...requirement, filePath: '' }))
    expect(back).toEqual(out.map((requirement) => ({ ...requirement, filePath: '' })))
  })

  // The other lossless format goes through the same plan, so it has to arrive the same.
  it('does the same through XML', async () => {
    const out = library()
    const plan = planJsonImport(readReqXml(toReqXml(out, { exported: '2026-09-25T10:00:00.000Z' })), [])
    const outcome = await porter.applyJsonPlan(plan)
    expect(outcome.failed).toEqual([])
    index.build()
    const back = index.requirementRefs().map((requirement) => ({ ...requirement, filePath: '' }))
    expect(back).toEqual(out.map((requirement) => ({ ...requirement, filePath: '' })))
  })

  it('has nothing left to do the second time the same file is imported', async () => {
    const out = library()
    const text = toReqJson(out, { exported: '2026-09-24T10:00:00.000Z' })
    await porter.applyJsonPlan(planJsonImport(readReqJson(text), []))
    index.build()

    const again = planJsonImport(readReqJson(text), index.requirementRefs())
    expect(again.map((row) => row.action)).toEqual(out.map(() => 'unchanged'))
  })

  // The note that goes is somebody's work, so only a row a person agreed to is written.
  it('replaces only what the plan called a replacement', async () => {
    const out = library()
    await porter.applyJsonPlan(planJsonImport(readReqJson(toReqJson(out, { exported: 'x' })), []))
    index.build()

    // Changed in every way a record can be: its title, a field, a wording, and whether
    // anybody has read the machine's translation.
    const edited = out.map((requirement) => {
      if (requirement.id !== 'REQ-THERM-0001') return requirement
      return {
        ...requirement,
        title: 'Titre venu du fichier',
        status: 'verified',
        text: {
          ...requirement.text,
          en: { ...requirement.text.en, body: 'Revised in the file.', reviewed: true }
        }
      }
    })
    const plan = planJsonImport(readReqJson(toReqJson(edited, { exported: 'x' })), index.requirementRefs())
    expect(plan.filter((row) => row.action === 'replace').map((row) => row.id)).toEqual(['REQ-THERM-0001'])

    const outcome = await porter.applyJsonPlan(plan)
    expect(outcome.updated).toEqual(['REQ-THERM-0001'])
    expect(outcome.created).toEqual([])
    index.build()
    // The record as it stands, not the fields somebody thought to copy across: that is
    // what a lossless format is for, and a restore that kept the old status or the old
    // translation would not be a restore.
    const written = index.requirementById('REQ-THERM-0001')
    expect({ ...written, filePath: '' }).toEqual({ ...edited[0], filePath: '' })
    // And the note followed its title, or the next save would address a file that is gone.
    expect(vault.getAbstractFileByPath('Requirements/REQ-THERM-0001 Titre venu du fichier.md')).not.toBeNull()
  })

  // ReqIF carries one wording and a few fields, so it updates the way a spreadsheet does:
  // what the file says is written, and everything it cannot say is left where it was.
  it('updates from a ReqIF field by field, keeping what the file cannot carry', async () => {
    await porter.applyJsonPlan(planJsonImport(readReqJson(toReqJson(library(), { exported: 'x' })), []))
    index.build()
    const held = index.requirementRefs()
    const file = (requirements: Requirement[]) => readReqif(toReqif(requirements, { lang: 'fr', title: 'B' }), 'fr')
    expect(planReqifImport(file(held), held).map((row) => row.action)).toEqual(['unchanged', 'unchanged'])

    const before = held.find((requirement) => requirement.id === 'REQ-THERM-0001')!
    const edited = held.map((requirement) =>
      requirement === before
        ? {
            ...requirement,
            status: 'verified',
            text: { ...requirement.text, fr: { ...requirement.text.fr, body: 'Entre 5 °C et 25 °C.' } }
          }
        : requirement
    )
    const plan = planReqifImport(file(edited), held)
    expect(plan.map((row) => [row.id, row.action])).toEqual([
      ['REQ-THERM-0001', 'update'],
      ['REQ-THERM-0002', 'unchanged']
    ])
    const outcome = await porter.applyCsvPlan(plan, 'dupont')
    expect(outcome).toEqual({ created: [], updated: ['REQ-THERM-0001'], failed: [] })

    index.build()
    const after = index.requirementById('REQ-THERM-0001')!
    expect(after.status).toBe('verified')
    expect(after.text.fr.body).toBe('Entre 5 °C et 25 °C.')
    // A new wording, counted as one: the revision moves, the old words go into the
    // history, and the translation — which the file never carried — is kept and known
    // to have fallen behind.
    expect(after.rev).toBe(before.rev + 1)
    expect(after.history).toHaveLength(before.history.length + 1)
    expect(after.text.en).toEqual(before.text.en)
    expect(isStale(after, 'en')).toBe(true)
    expect(after.aliases).toEqual(['OMLX-THERM-0001'])
    // And the one the file did not change is exactly as it was, suspect link included.
    expect(index.requirementById('REQ-THERM-0002')).toEqual(held.find((each) => each.id === 'REQ-THERM-0002'))
  })
})
