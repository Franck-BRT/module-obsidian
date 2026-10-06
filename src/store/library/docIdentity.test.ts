import { describe, expect, it } from 'vitest'
import { guessIdentity } from './docIdentity'

describe('guessIdentity', () => {
  it('reads a cover page: reference, edition, revision', () => {
    const cover = [
      'CENTRE NATIONAL D’ÉTUDES SPATIALES',
      'Réf. : DLA-NM-0000000-01-PSP',
      'Edition : 02 Date : 20/07/2007',
      'Révision : 15 Date : 30/09/2016',
      'GLOSSAIRE DES SIGLES'
    ].join('\n')
    expect(guessIdentity(cover, 'glossaire.pdf')).toEqual({
      reference: 'DLA-NM-0000000-01-PSP',
      edition: '2',
      revision: '15'
    })
  })

  it('reads an index as the revision, and the English words too', () => {
    expect(guessIdentity('CCTP Lot 02 — Indice B — 12/03/2026', 'cctp.pdf')).toEqual({ revision: 'B' })
    expect(guessIdentity('Document No: ECSS-E-AS-11C\nIssue 1 Revision 3', 'x.pdf')).toEqual({
      reference: 'ECSS-E-AS-11C',
      edition: '1',
      revision: '3'
    })
    expect(guessIdentity('Plan qualité — Version 2.1', 'pq.docx')).toEqual({ edition: '2', revision: '1' })
  })

  it('falls back on the file’s name for what the text does not say', () => {
    expect(guessIdentity('', 'Spec_ed2_rev15.pdf')).toEqual({ edition: '2', revision: '15' })
    expect(guessIdentity('', 'Plan RDC indB.pdf')).toEqual({ revision: 'B' })
    expect(guessIdentity('', 'Note technique v3.pdf')).toEqual({ edition: '3' })
    expect(guessIdentity('', 'ECSS-E-AS-11C.pdf')).toEqual({ reference: 'ECSS-E-AS-11C' })
    // A numbering of one's own, or a code in a lower-case name, is not taken for one.
    expect(guessIdentity('', 'DA1.3_glossaire.pdf')).toEqual({})
    expect(guessIdentity('', 'plan-rdc-2.pdf')).toEqual({})
  })

  it('takes neither a date, a lone word nor a plain number for a reference', () => {
    expect(guessIdentity('Réf. : 12/03/2026', 'a.pdf')).toEqual({})
    expect(guessIdentity('Référence : voir annexe', 'a.pdf')).toEqual({})
    expect(guessIdentity('Réf. 12345', 'a.pdf')).toEqual({})
    expect(guessIdentity('Plan RDC', 'Plan RDC.pdf')).toEqual({})
  })
})
