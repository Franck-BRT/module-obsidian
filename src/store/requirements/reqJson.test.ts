import { describe, expect, it } from 'vitest'
import { addLink, makeRequirement, setText, type Requirement } from './Requirement'
import { addAlias } from './reqAlias'
import { readReqJson, REQ_JSON_FORMAT, toReqJson } from './reqJson'

const OPTIONS = { exported: '2026-09-24T10:00:00.000Z' }

function sample(): Requirement {
  let requirement = makeRequirement({
    id: 'REQ-THERM-0001',
    title: 'Maintien en température',
    category: 'THERM',
    type: 'performance',
    status: 'approved',
    criticality: 'critical',
    verification: 'test',
    source: 'CLI-2026-014 §6.1',
    rationale: 'Les cartes décrochent au-delà.',
    owner: 'F. Dubourthoumieu',
    tags: ['soute', 'thermique'],
    sourceLang: 'fr',
    history: [{ rev: 1, at: '2026-09-12T08:00:00.000Z', by: 'franck', lang: 'fr', was: 'Autrefois.', note: 'Revue.' }]
  })
  requirement = setText(requirement, 'fr', 'La soute doit rester entre 5 °C et 30 °C.', 'franck')
  requirement = setText(requirement, 'en', 'The hold shall stay between 5 °C and 30 °C.', 'sidonie', 'machine')
  requirement = addLink(requirement, 'derives-from', 'REQ-SYS-0001')
  return addAlias(requirement, 'OMLX-THERM-0001')
}

describe('the file', () => {
  const file = () => JSON.parse(toReqJson([sample()], OPTIONS)) as Record<string, unknown>

  it('says what it is before it says anything else', () => {
    expect(file()).toMatchObject({ format: REQ_JSON_FORMAT, version: 1, exported: OPTIONS.exported, count: 1 })
  })

  // So a reader knows what to expect before parsing four hundred records.
  it('names the languages the library is written in', () => {
    expect(file().languages).toEqual(['en', 'fr'])
  })

  it('ends with a newline, as a text file should', () => {
    expect(toReqJson([sample()], OPTIONS).endsWith('}\n')).toBe(true)
  })

  // A JSON export lands in a repository as often as in a script.
  it('gives the same bytes for the same library, whatever order it arrived in', () => {
    const a = makeRequirement({ id: 'REQ-A-0001' })
    const b = makeRequirement({ id: 'REQ-B-0002' })
    expect(toReqJson([a, b], OPTIONS)).toBe(toReqJson([b, a], OPTIONS))
  })

  it('is indented, so a diff shows what changed rather than that something did', () => {
    expect(toReqJson([sample()], OPTIONS)).toContain('\n  "requirements": [\n')
  })
})

describe('what a record holds', () => {
  const record = () =>
    (JSON.parse(toReqJson([sample()], OPTIONS)) as { requirements: Record<string, unknown>[] }).requirements[0]

  // The same function that writes a requirement's frontmatter writes its record, so the
  // two cannot disagree about what a requirement is.
  it('is the note, key for key', () => {
    expect(record()).toMatchObject({
      'pm-requirement': true,
      id: 'REQ-THERM-0001',
      category: 'THERM',
      verification: 'test',
      tags: ['soute', 'thermique'],
      aliases: ['OMLX-THERM-0001']
    })
  })

  it('keeps what a wording knows about itself, which a table would have dropped', () => {
    expect(record().text).toMatchObject({
      en: { origin: 'machine', reviewed: false, fromRev: 1 },
      fr: { origin: 'human', reviewed: true }
    })
  })

  it('keeps the revisions and the links', () => {
    expect(record().links).toEqual([{ kind: 'derives-from', to: 'REQ-SYS-0001' }])
    expect(record().history).toHaveLength(1)
  })

  it('writes no line for a field the requirement never filled in', () => {
    const bare = JSON.parse(toReqJson([makeRequirement({ id: 'REQ-A-0001' })], OPTIONS)) as {
      requirements: Record<string, unknown>[]
    }
    expect(bare.requirements[0].rationale).toBeUndefined()
    expect(bare.requirements[0].links).toBeUndefined()
  })
})

describe('reading it back', () => {
  /**
   * The evidence that the export is lossless rather than the claim that it is: a record
   * that goes out and comes back the same requirement holds everything.
   */
  it('gives back the requirement that went in', () => {
    const before = sample()
    const [after] = readReqJson(toReqJson([before], OPTIONS)).requirements
    expect({ ...after, filePath: before.filePath }).toEqual(before)
  })

  it('says what it could not read rather than skipping it quietly', () => {
    const read = readReqJson('{"format":"x","requirements":[{"title":"sans identifiant"},"deux"]}')
    expect(read.requirements).toEqual([])
    expect(read.problems).toEqual(['format: x', 'requirements[0]: no identifier', 'requirements[1]: not an object'])
  })

  it('survives something that is not JSON at all', () => {
    expect(readReqJson('{').requirements).toEqual([])
    expect(readReqJson('{').problems).toHaveLength(1)
  })

  // The fields this build knows are still the fields it knows.
  it('reads a file from a later version as far as it can, and says so', () => {
    const later = toReqJson([sample()], OPTIONS).replace('"version": 1', '"version": 9')
    const read = readReqJson(later)
    expect(read.requirements).toHaveLength(1)
    expect(read.problems).toEqual(['version: 9'])
  })
})
