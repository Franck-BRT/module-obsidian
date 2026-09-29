import { describe, expect, it } from 'vitest'
import { cleanTags, guessCategory, knownValues, mergeClassification, parseCategories } from './libraryClass'
import type { LibraryDoc } from './libraryDoc'

const LIST = parseCategories(`
# Les catégories de la maison
Plan : plan, coupe, façade, dwg
Planning : planning, phasage, gantt
Compte rendu : cr, pv, compte rendu, réunion
Note de calcul : ndc, note de calcul
Photo : photo, img, jpg, jpeg
Plan : doublon ignoré
Divers
`)

const doc = (over: Partial<LibraryDoc>): LibraryDoc => ({
  record: 'r.md',
  title: 'x',
  file: 'x.pdf',
  projects: [],
  added: '',
  size: 0,
  hash: '',
  category: '',
  lot: '',
  issuer: '',
  tags: [],
  folder: '',
  ...over
})

describe('parseCategories', () => {
  it('reads a category a line, its words after a colon, folded; a comment, a blank and a repeat ignored', () => {
    expect(LIST.map((category) => category.name)).toEqual([
      'Plan',
      'Planning',
      'Compte rendu',
      'Note de calcul',
      'Photo',
      'Divers'
    ])
    expect(LIST[0].keywords).toEqual(['plan', 'coupe', 'facade', 'dwg'])
    expect(LIST[5].keywords).toEqual([])
  })
})

describe('guessCategory', () => {
  it('files a name by the words it holds, whole words only, the list’s order deciding between equals', () => {
    expect(guessCategory('CR_réunion-12.pdf', LIST)).toBe('Compte rendu')
    expect(guessCategory('Planning GC indice C.pdf', LIST)).toBe('Planning')
    expect(guessCategory('Plan de coffrage R+1.pdf', LIST)).toBe('Plan')
    expect(guessCategory('IMG_2031.JPG', LIST)).toBe('Photo')
    expect(guessCategory('NDC radier.pdf', LIST)).toBe('Note de calcul')
    // « cr » is not in « écran », nor « plan » in « planning ».
    expect(guessCategory('Écran de contrôle.pdf', LIST)).toBe('')
    expect(guessCategory('Planning.pdf', LIST)).toBe('Planning')
  })

  it('takes a phrase as one, and the category answering the most words', () => {
    expect(guessCategory('Note de calcul du radier.pdf', LIST)).toBe('Note de calcul')
    expect(guessCategory('Compte rendu de réunion — photo.pdf', LIST)).toBe('Compte rendu')
  })

  it('keeps the first of two categories a name answers as well', () => {
    expect(guessCategory('Plan et planning.pdf', LIST)).toBe('Plan')
  })

  it('knows a category by its own name too', () => {
    expect(guessCategory('Divers 2026.pdf', LIST)).toBe('Divers')
  })
})

describe('cleanTags', () => {
  it('takes tags as Obsidian does: no hash, no spaces, no punctuation, no number alone, once each', () => {
    expect(cleanTags('#chantier, zone B; Réception ,, 2026, #CHANTIER, lot/2')).toEqual([
      'chantier',
      'zone-B',
      'Réception',
      'lot/2'
    ])
    expect(cleanTags(['a!', ' b '])).toEqual(['a', 'b'])
  })
})

describe('knownValues', () => {
  it('suggests the values the library holds, the most used first', () => {
    const docs = [
      doc({ lot: 'Lot 2', tags: ['chantier'] }),
      doc({ lot: 'Lot 1', tags: ['chantier', 'zone-B'] }),
      doc({ lot: 'Lot 2' }),
      doc({})
    ]
    expect(knownValues(docs, 'lot')).toEqual(['Lot 2', 'Lot 1'])
    expect(knownValues(docs, 'tags')).toEqual(['chantier', 'zone-B'])
    expect(knownValues(docs, 'issuer')).toEqual([])
  })
})

describe('mergeClassification', () => {
  it('replaces with what is given, leaves what is not, and adds tags', () => {
    const current = { category: 'Plan', lot: 'Lot 1', issuer: 'Setec', tags: ['chantier'] }
    expect(mergeClassification(current, { lot: 'Lot 2', issuer: '  ', tags: ['zone-B', 'Chantier'] })).toEqual({
      category: 'Plan',
      lot: 'Lot 2',
      issuer: 'Setec',
      tags: ['chantier', 'zone-B']
    })
  })
})

describe('the shipped French categories', () => {
  it('file the names a site sends', async () => {
    const { fr } = await import('../../i18n/fr')
    const shipped = fr['library.defaultCategories']
    if (typeof shipped !== 'string') throw new Error('the shipped categories are one text')
    const list = parseCategories(shipped)
    const cases: [string, string][] = [
      ['CR réunion de chantier n°12.pdf', 'Compte rendu'],
      ['PV de réception.pdf', 'Compte rendu'],
      ['Plan masse indice B.dwg', 'Plan'],
      ['Planning GC indice C.pdf', 'Planning'],
      ['DPGF lot 2 terrassements.xlsx', 'Devis'],
      ['Situation n°4.pdf', 'Facture'],
      ['Avenant 2 au marché.pdf', 'Contrat'],
      ['NDC radier.pdf', 'Note de calcul'],
      ['IMG_2031.JPG', 'Photo'],
      ['NF P94-500.pdf', 'Norme'],
      ['CCTP Lot 02.docx', 'CCTP'],
      ['Rapport géotechnique G2.pdf', 'Rapport'],
      ['Lettre de mise en demeure.docx', 'Courrier'],
      ['Tableau de bord.xlsx', '']
    ]
    for (const [name, category] of cases) expect([name, guessCategory(name, list)]).toEqual([name, category])
  })
})
