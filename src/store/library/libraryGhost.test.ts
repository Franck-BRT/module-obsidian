import { describe, expect, it } from 'vitest'
import { ghostContent, ghostTarget, isGhost } from './libraryGhost'

describe('ghosts', () => {
  it('writes what the ghost stands for, and a line for whoever opens it', () => {
    const content = ghostContent(
      { record: 'Bibliothèque/Normes/Glossaire.md', title: 'Glossaire [DLA]', hash: 'abc', folder: 'Normes' },
      { line: (link, folder) => `Le document ${link} est dans « ${folder} ».` }
    )
    expect(content).toBe(
      [
        '---',
        'pm-library-ghost: true',
        'of: "[[Bibliothèque/Normes/Glossaire.md]]"',
        'title: Glossaire [DLA]',
        'sha256: abc',
        '---',
        '',
        'Le document [[Bibliothèque/Normes/Glossaire.md|Glossaire  DLA ]] est dans « Normes ».',
        ''
      ].join('\n')
    )
  })

  it('knows a ghost by its property', () => {
    expect(isGhost({ 'pm-library-ghost': true })).toBe(true)
    expect(isGhost({ 'pm-library-doc': true })).toBe(false)
    expect(isGhost(undefined)).toBe(false)
  })

  it('finds its document by its link, else by its fingerprint', () => {
    const docs = [
      { record: 'a.md', hash: '1' },
      { record: 'b.md', hash: '2' }
    ]
    expect(ghostTarget({ hash: '2' }, docs[0], docs)).toBe(docs[0])
    expect(ghostTarget({ hash: '2' }, undefined, docs)).toBe(docs[1])
    expect(ghostTarget({ hash: '' }, undefined, docs)).toBeUndefined()
  })
})
