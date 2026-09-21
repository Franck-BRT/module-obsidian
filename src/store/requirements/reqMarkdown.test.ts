import { describe, expect, it } from 'vitest'
import { makeRequirement, setText } from './Requirement'
import { toMarkdownDocument } from './reqMarkdown'

function req(id: string, fr: string, over: Parameters<typeof makeRequirement>[0] = {}) {
  return setText(makeRequirement({ id, sourceLang: 'fr', ...over }), 'fr', fr, 'franck')
}

const OPTIONS = { title: 'Spécification', lang: 'fr', at: '2026-03-14T10:00:00.000Z' }

describe('toMarkdownDocument', () => {
  const library = [
    req('REQ-SYS-0001', 'La trappe doit ouvrir en 3 s.', { title: 'Trappe', category: 'SYS', status: 'approved' }),
    req('REQ-SYS-0002', 'Le bus doit tenir 3 h.', { category: 'SYS' }),
    req('REQ-ELEC-0001', 'La masse doit être unique.', { category: 'ELEC' })
  ]

  it('writes the words on the page, for a reader who has never heard of this plugin', () => {
    const document = toMarkdownDocument(library, OPTIONS)
    expect(document).toContain('La trappe doit ouvrir en 3 s.')
    expect(document).toContain('### REQ-SYS-0001 — Trappe')
  })

  it('groups under the category, which is the grouping the identifiers already show', () => {
    const document = toMarkdownDocument(library, OPTIONS)
    expect(document).toContain('## SYS')
    expect(document).toContain('## ELEC')
    expect([...document.matchAll(/^## SYS$/gm)]).toHaveLength(1)
  })

  it('says what it is and when it was taken, because it is a snapshot', () => {
    const document = toMarkdownDocument(library, OPTIONS)
    expect(document).toContain('exported: "2026-03-14T10:00:00.000Z"')
    expect(document).toContain('count: 3')
  })

  it('stands the source wording in where the language asked for was never written', () => {
    expect(toMarkdownDocument([library[0]], { ...OPTIONS, lang: 'en' })).toContain('La trappe doit ouvrir en 3 s.')
  })

  it('says so rather than leaving a blank where nothing was written at all', () => {
    expect(toMarkdownDocument([makeRequirement({ id: 'REQ-SYS-0009' })], OPTIONS)).toContain('*—*')
  })

  it('names a category nobody gave', () => {
    expect(toMarkdownDocument([req('REQ-GEN-0001', 'Sans catégorie.')], OPTIONS)).toContain('## Sans catégorie')
  })
})
