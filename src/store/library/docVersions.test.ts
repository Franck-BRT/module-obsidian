import { describe, expect, it } from 'vitest'
import { asksForComparison, changesBlock, documentChanges } from './docDiff'
import { previousVersion, versionKey } from './docVersions'

describe('the versions of a document, by their names', () => {
  it('names a document whatever its issue', () => {
    const key = versionKey('CCTP lot 02 ind A.pdf')
    expect(key).toBe('cctp lot 02')
    for (const name of [
      'CCTP lot 02 ind B.pdf',
      'CCTP_lot_02_indice_C.pdf',
      'CCTP lot 02 - rév. 3.pdf',
      'CCTP lot 02 v2.pdf'
    ]) {
      expect(versionKey(name)).toBe(key)
    }
    expect(versionKey('Plan RDC - B.dwg')).toBe(versionKey('Plan RDC - A.pdf'))
    expect(versionKey('CR réunion de chantier n°5.docx')).not.toBe(versionKey('CR réunion de chantier n°6.docx'))
    expect(versionKey('CR v2')).toBe('')
  })

  it('finds the version a new one follows: same name, other content, the last of its line', () => {
    const a = {
      record: 'L/A.md',
      title: 'CCTP lot 02 ind A',
      file: 'F/CCTP lot 02 ind A.pdf',
      hash: 'a',
      added: '2026-09-01'
    }
    const b = {
      ...a,
      record: 'L/B.md',
      title: 'CCTP lot 02 ind B',
      file: 'F/CCTP lot 02 ind B.pdf',
      hash: 'b',
      added: '2026-10-01',
      previous: 'L/A.md'
    }
    const other = {
      record: 'L/P.md',
      title: 'Planning lot 02',
      file: 'F/Planning.xlsx',
      hash: 'p',
      added: '2026-10-01'
    }
    const c = {
      record: 'L/C.md',
      title: 'CCTP lot 02 ind C',
      file: 'F/CCTP lot 02 ind C.pdf',
      hash: 'c',
      added: '2026-10-02'
    }
    expect(previousVersion(c, [a, b, other])?.record).toBe('L/B.md')
    expect(previousVersion(b, [a, other])?.record).toBe('L/A.md')
    // The same bytes again is the same document, not a new issue of it.
    expect(previousVersion({ ...c, hash: 'a' }, [a])).toBeNull()
    expect(previousVersion(other, [a, b])).toBeNull()
  })
})

const IND_A = `# CCTG Lot 02 Gros œuvre — indice A

## Article 2 — Bétons

La résistance minimale est C25/30 pour les fondations et C30/37 pour les voiles.
Le béton provient d'une centrale certifiée NF.
Tout ajout d'eau sur chantier est interdit.

## Article 3 — Armatures

Les aciers sont de nuance B500B.
Les plans d'armatures sont soumis au visa quinze jours avant le ferraillage.

## Article 7 — Documents à remettre

Le PAQ est remis le 02/11/2026.`

const IND_B = `# CCTG Lot 02 Gros œuvre — indice B

## Article 2 — Bétons

La résistance minimale est C25/30 pour les fondations et C35/45 pour les voiles.
Le béton provient d'une centrale certifiée NF.
Des essais de convenance sont exigés avant le premier coulage.

## Article 3 — Armatures

Les aciers sont de nuance B500B.
Les plans d'armatures sont soumis au visa quinze jours avant le ferraillage.

## Article 7 — Documents à remettre

Le PAQ est remis le 09/11/2026.`

describe('what changed from one version to the next', () => {
  it('finds each passage rewritten, added or taken out, under its article', () => {
    const changes = documentChanges(IND_A, IND_B)
    expect(changes.same).toBe(false)
    // An article's blocks together: each run of lines changed is one.
    const bySection = new Map<string, { removed: string[]; added: string[] }>()
    for (const block of changes.blocks) {
      const own = bySection.get(block.section) ?? { removed: [], added: [] }
      own.removed.push(...block.removed)
      own.added.push(...block.added)
      bySection.set(block.section, own)
    }
    const betons = bySection.get('## Article 2 — Bétons')
    expect(betons?.removed).toEqual([
      'La résistance minimale est C25/30 pour les fondations et C30/37 pour les voiles.',
      "Tout ajout d'eau sur chantier est interdit."
    ])
    expect(betons?.added).toContain('La résistance minimale est C25/30 pour les fondations et C35/45 pour les voiles.')
    expect(changes.blocks.some((block) => block.removed.includes("Tout ajout d'eau sur chantier est interdit."))).toBe(
      true
    )
    expect(
      changes.blocks.some((block) =>
        block.added.includes('Des essais de convenance sont exigés avant le premier coulage.')
      )
    ).toBe(true)
    // The article untouched is not said.
    expect(bySection.has('## Article 3 — Armatures')).toBe(false)
    expect(changes.datesRemoved.map((one) => one.date)).toEqual(['2026-11-02'])
    expect(changes.datesAdded.map((one) => one.date)).toEqual(['2026-11-09'])
  })

  it('says when the two read the same, spacing aside', () => {
    expect(documentChanges(IND_A, IND_A.replace(/ {1}/g, '  ')).same).toBe(true)
  })

  it('writes them out for the model, out with « − », in with « + », the dates last', () => {
    const block = changesBlock({ before: 'ind A', after: 'ind B' }, documentChanges(IND_A, IND_B), {
      intro: (before, after) => `De ${before} à ${after} :`,
      same: 'identiques',
      removed: 'retiré',
      added: 'ajouté',
      start: 'Début',
      datesAdded: 'Dates nouvelles :',
      datesRemoved: 'Dates disparues :',
      more: (count) => `+${count}`
    })
    expect(block).toContain('De ind A à ind B :')
    expect(block).toContain('### Article 2 — Bétons\n− La résistance minimale est C25/30 pour les fondations et C30/37')
    expect(block).toContain('Dates disparues :\n− 2026-11-02')
    expect(block).toContain('Dates nouvelles :\n+ 2026-11-09')
  })

  it('is asked for by the words of a comparison', () => {
    expect(asksForComparison('Compare les deux indices')).toBe(true)
    expect(asksForComparison("Qu'est-ce qui a changé ?")).toBe(true)
    expect(asksForComparison('What changed between them?')).toBe(true)
    expect(asksForComparison('Résume ce document')).toBe(false)
  })
})
