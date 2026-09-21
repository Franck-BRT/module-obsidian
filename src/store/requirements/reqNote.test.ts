import { describe, expect, it } from 'vitest'
import { makeRequirement, setText } from './Requirement'
import { hydrateRequirement } from './reqYaml'
import { orderedLanguages, requirementBodyRemainder, serializeRequirement } from './reqNote'
import { parseFrontmatter } from '../YamlParser'

function sample() {
  let requirement = makeRequirement({ id: 'REQ-SYS-0001', title: 'Vol habité', sourceLang: 'fr', category: 'Système' })
  requirement = setText(requirement, 'fr', 'Le système doit résister à 3 g.', 'franck')
  requirement = setText(requirement, 'en', 'The system shall withstand 3 g.', 'franck')
  return requirement
}

describe('orderedLanguages', () => {
  it('puts the source language first, whatever the order they were written in', () => {
    expect(orderedLanguages(sample())).toEqual(['fr', 'en'])
  })

  it('leaves out a source language nothing was written in', () => {
    const requirement = setText(makeRequirement({ sourceLang: 'fr' }), 'en', 'Only English here.', 'a')
    expect(orderedLanguages(requirement)).toEqual(['en'])
  })
})

describe('serializeRequirement', () => {
  it('writes a note whose frontmatter reads back as the same requirement', () => {
    const requirement = sample()
    const { frontmatter } = parseFrontmatter(serializeRequirement(requirement))
    expect(frontmatter).not.toBeNull()
    const back = hydrateRequirement(frontmatter as Record<string, unknown>, 'Requirements/REQ-SYS-0001.md')
    expect(back.id).toBe('REQ-SYS-0001')
    expect(back.title).toBe('Vol habité')
    expect(back.category).toBe('Système')
    expect(back.rev).toBe(requirement.rev)
    expect(back.text.fr.body).toBe('Le système doit résister à 3 g.')
    expect(back.text.en.body).toBe('The system shall withstand 3 g.')
    expect(back.text.en.fromRev).toBe(requirement.text.en.fromRev)
  })

  it('shows every wording in the body, so the note reads without the plugin', () => {
    const note = serializeRequirement(sample())
    const body = note.slice(note.indexOf('---', 3) + 3)
    expect(body).toContain('# REQ-SYS-0001 — Vol habité')
    expect(body).toContain('## FR')
    expect(body).toContain('Le système doit résister à 3 g.')
    expect(body).toContain('## EN')
  })

  it('keeps frontmatter it does not own', () => {
    const note = serializeRequirement(sample(), { cssclass: 'wide' })
    expect(note).toContain('cssclass: wide')
  })

  it('keeps whatever the reader typed under the generated sections', () => {
    const requirement = sample()
    const first = serializeRequirement(requirement)
    const edited = `${first}\n## Notes\n\nDiscuté en revue du 3 mars.\n`
    const { body } = parseFrontmatter(edited)
    const kept = requirementBodyRemainder(body, requirement)
    expect(kept).toBe('## Notes\n\nDiscuté en revue du 3 mars.')
    expect(serializeRequirement(requirement, {}, kept)).toContain('Discuté en revue du 3 mars.')
  })

  it('does not keep its own output as if the reader had written it', () => {
    const requirement = sample()
    const { body } = parseFrontmatter(serializeRequirement(requirement))
    expect(requirementBodyRemainder(body, requirement)).toBe('')
  })

  it('writes a body it did not recognise back rather than dropping it', () => {
    const requirement = sample()
    expect(requirementBodyRemainder('Une note écrite à la main.', requirement)).toBe('Une note écrite à la main.')
  })
})
