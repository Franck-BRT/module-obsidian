import { describe, expect, it } from 'vitest'
import { AT_ROOT } from '../folderFilter'
import {
  collectionNames,
  familyOf,
  inCollection,
  nextCollections,
  fingerprint,
  fold,
  isLibraryDoc,
  linkPath,
  matchesDoc,
  NO_PROJECT,
  NO_VALUE,
  sortDocs,
  stringList,
  titleFromName,
  type LibraryDoc
} from './libraryDoc'

const doc = (over: Partial<LibraryDoc>): LibraryDoc => ({
  record: 'Bibliothèque/x.md',
  title: 'x',
  file: 'Bibliothèque/Fichiers/x.pdf',
  projects: [],
  added: '2026-09-28',
  size: 1,
  hash: '',
  category: '',
  lot: '',
  issuer: '',
  tags: [],
  folder: '',
  ...over
})
const TITLES: Record<string, string> = { 'P/Génie civil.md': 'Génie civil', 'P/Tunnel.md': 'Tunnel' }
const title = (path: string): string => TITLES[path] ?? ''
const query = (text: string, over: { project?: string; family?: '' | 'pdf' | 'sheet' } = {}) => ({
  text,
  project: over.project ?? '',
  family: over.family ?? ''
})

describe('libraryDoc', () => {
  it('knows its records by their flag alone', () => {
    expect(isLibraryDoc({ 'pm-library-doc': true })).toBe(true)
    expect(isLibraryDoc({ 'pm-library-doc': 'true' })).toBe(false)
    expect(isLibraryDoc(null)).toBe(false)
  })

  it('sorts files into kinds by extension, whatever its case', () => {
    expect(familyOf('a/Plan.PDF')).toBe('pdf')
    expect(familyOf('CCTP.docx')).toBe('word')
    expect(familyOf('Planning.xlsx')).toBe('sheet')
    expect(familyOf('Revue.pptx')).toBe('slides')
    expect(familyOf('photo.jpeg')).toBe('image')
    expect(familyOf('mail.msg')).toBe('mail')
    expect(familyOf('archive.zip')).toBe('other')
    expect(familyOf('sans-extension')).toBe('other')
  })

  it('titles a file by its name, the underscores and doubled spaces cleaned', () => {
    expect(titleFromName('Planning_GC__S39  v2.pdf')).toBe('Planning GC S39 v2')
    expect(titleFromName('.pdf')).toBe('.pdf')
  })

  it('reads a list that may be one string, a list, or nothing', () => {
    expect(stringList(' a ')).toEqual(['a'])
    expect(stringList(['a', 3, '', 'b'])).toEqual(['a', 'b'])
    expect(stringList(undefined)).toEqual([])
  })

  it('reads the path out of a link', () => {
    expect(linkPath('[[Work/GC.md|Génie civil]]')).toBe('Work/GC.md')
    expect(linkPath('[[Plan.pdf#page=2]]')).toBe('Plan.pdf')
    expect(linkPath('Work/GC.md')).toBe('Work/GC.md')
  })

  it('folds case and accents', () => {
    expect(fold('Échéancier Génie')).toBe('echeancier genie')
  })

  it('finds a document by every word typed, in its title, file name, projects and tags', () => {
    const planning = doc({
      title: 'Planning S39',
      file: 'Bibliothèque/Fichiers/pl_gc_39.pdf',
      projects: ['P/Génie civil.md'],
      tags: ['chantier']
    })
    expect(matchesDoc(planning, query('planning genie'), title)).toBe(true)
    expect(matchesDoc(planning, query('pl_gc'), title)).toBe(true)
    expect(matchesDoc(planning, query('CHANTIER s39'), title)).toBe(true)
    expect(matchesDoc(planning, query('planning tunnel'), title)).toBe(false)
    expect(matchesDoc(planning, query('   '), title)).toBe(true)
  })

  it('finds a document by what it says too, some words in its name and others in its text', () => {
    const cr = doc({ title: 'CR réunion 12' })
    const said = (): string => 'le radier est decale au 19/10'
    expect(matchesDoc(cr, query('radier'), title, said)).toBe(true)
    expect(matchesDoc(cr, query('reunion radier'), title, said)).toBe(true)
    expect(matchesDoc(cr, query('reunion tunnel'), title, said)).toBe(false)
    expect(matchesDoc(cr, query('radier'), title)).toBe(false)
  })

  it('does not find a word in the folders a file sits in', () => {
    expect(matchesDoc(doc({ file: 'Bibliothèque/Fichiers/x.pdf' }), query('fichiers'), title)).toBe(false)
  })

  it('filters by project, by no project, and by kind', () => {
    const inGc = doc({ projects: ['P/Génie civil.md', 'P/Tunnel.md'] })
    const loose = doc({ file: 'Bibliothèque/Fichiers/tableau.xlsx' })
    expect(matchesDoc(inGc, query('', { project: 'P/Tunnel.md' }), title)).toBe(true)
    expect(matchesDoc(loose, query('', { project: 'P/Tunnel.md' }), title)).toBe(false)
    expect(matchesDoc(loose, query('', { project: NO_PROJECT }), title)).toBe(true)
    expect(matchesDoc(inGc, query('', { project: NO_PROJECT }), title)).toBe(false)
    expect(matchesDoc(loose, query('', { family: 'sheet' }), title)).toBe(true)
    expect(matchesDoc(inGc, query('', { family: 'sheet' }), title)).toBe(false)
  })

  it('filters by category, lot, issuer — or their absence — and tag, whatever the case', () => {
    const plan = doc({ category: 'Plan', lot: 'Lot 2', issuer: 'Setec', tags: ['Chantier'] })
    const bare = doc({})
    const q = (over: object) => ({ ...query(''), ...over })
    expect(matchesDoc(plan, q({ category: 'plan' }), title)).toBe(true)
    expect(matchesDoc(bare, q({ category: 'Plan' }), title)).toBe(false)
    expect(matchesDoc(bare, q({ category: NO_VALUE }), title)).toBe(true)
    expect(matchesDoc(plan, q({ category: NO_VALUE }), title)).toBe(false)
    expect(matchesDoc(plan, q({ lot: 'Lot 2', issuer: 'setec' }), title)).toBe(true)
    expect(matchesDoc(plan, q({ lot: 'Lot 1' }), title)).toBe(false)
    expect(matchesDoc(plan, q({ issuer: NO_VALUE }), title)).toBe(false)
    expect(matchesDoc(plan, q({ tag: 'chantier' }), title)).toBe(true)
    expect(matchesDoc(bare, q({ tag: 'chantier' }), title)).toBe(false)
  })

  it('finds a document by its category, lot and issuer typed in the search', () => {
    const plan = doc({ title: 'Coffrage', category: 'Plan', lot: 'Lot 2', issuer: 'Setec' })
    expect(matchesDoc(plan, query('plan setec'), title)).toBe(true)
    expect(matchesDoc(plan, query('lot 2'), title)).toBe(true)
  })

  it('sorts by category, those with none last, then by title', () => {
    const docs = [
      doc({ record: 'a', title: 'Z', category: 'Plan' }),
      doc({ record: 'b', title: 'A', category: '' }),
      doc({ record: 'c', title: 'B', category: 'Compte rendu' }),
      doc({ record: 'd', title: 'A', category: 'Plan' })
    ]
    expect(sortDocs(docs, 'category').map((d) => d.record)).toEqual(['c', 'd', 'a', 'b'])
  })

  it('sorts the latest first, or by title with numbers read as numbers', () => {
    const docs = [
      doc({ record: 'a', title: 'Lot 10', added: '2026-09-01' }),
      doc({ record: 'b', title: 'lot 2', added: '2026-09-20' }),
      doc({ record: 'c', title: 'Avenant', added: '2026-09-20' }),
      doc({ record: 'd', title: 'Zone B', added: '2026-09-25' })
    ]
    expect(sortDocs(docs, 'added').map((d) => d.record)).toEqual(['d', 'c', 'b', 'a'])
    expect(sortDocs(docs, 'title').map((d) => d.record)).toEqual(['c', 'b', 'a', 'd'])
    expect(sortDocs([docs[0], docs[1]], 'title').map((d) => d.record)).toEqual(['b', 'a'])
  })

  it('fingerprints bytes as SHA-256', async () => {
    expect(await fingerprint(new TextEncoder().encode('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    )
  })

  it('filters by folder: the root alone, or a folder with those it holds', () => {
    const root = doc({ title: 'a' })
    const plans = doc({ title: 'b', folder: 'Plans' })
    const lot = doc({ title: 'c', folder: 'Plans/Lot 2' })
    const other = doc({ title: 'd', folder: 'Plans bis' })
    const all = [root, plans, lot, other]
    const inFolder = (folder: string): string[] =>
      all
        .filter((each) => matchesDoc(each, { text: '', project: '', family: '', folder }, title))
        .map((each) => each.title)
    expect(inFolder('')).toEqual(['a', 'b', 'c', 'd'])
    expect(inFolder(AT_ROOT)).toEqual(['a'])
    expect(inFolder('Plans')).toEqual(['b', 'c'])
    expect(inFolder('Plans/Lot 2')).toEqual(['c'])
    // A folder's name is found by a search too.
    expect(matchesDoc(lot, { text: 'lot 2', project: '', family: '' }, title)).toBe(true)
  })
})

describe('collections of documents', () => {
  const a = doc({ title: 'CCTP', collections: ['CCTP Lot 02', 'Normes'] })
  const b = doc({ title: 'NF C 15-100', collections: ['Normes'] })
  const c = doc({ title: 'Plan' })

  it('are named by what the documents say, the fullest first, and filter, case and accents aside', () => {
    expect(collectionNames([a, b, c])).toEqual(['Normes', 'CCTP Lot 02'])
    expect(inCollection(a, 'cctp lot 02')).toBe(true)
    expect(inCollection(c, 'Normes')).toBe(false)
    const query = { text: '', project: '', family: '' as const, collection: 'normes' }
    expect([a, b, c].filter((one) => matchesDoc(one, query, (p) => p)).map((one) => one.title)).toEqual([
      'CCTP',
      'NF C 15-100'
    ])
  })

  it('change by what is ticked and unticked, the rest left as it was', () => {
    expect(nextCollections(a, new Set(['Lot 03']), new Set(['normes']))).toEqual(['CCTP Lot 02', 'Lot 03'])
    expect(nextCollections(c, new Set(['Normes']), new Set())).toEqual(['Normes'])
  })
})
