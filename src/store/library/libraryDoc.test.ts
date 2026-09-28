import { describe, expect, it } from 'vitest'
import {
  familyOf,
  fingerprint,
  fold,
  isLibraryDoc,
  linkPath,
  matchesDoc,
  NO_PROJECT,
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
  tags: [],
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
})
