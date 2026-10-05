import { beforeAll, describe, expect, it } from 'vitest'
import { setLocale } from '../../i18n'
import type { LibraryDoc } from '../../store/library/libraryDoc'
import { libraryKey } from '../../store/rag/ragSources'
import { ragDocState, ragFilingWords } from './ragState'

beforeAll(() => setLocale('fr'))

const doc: LibraryDoc = {
  record: 'Bibliothèque/CCTP.md',
  title: 'CCTP Lot 02',
  file: 'Bibliothèque/_files/CCTP.pdf',
  projects: [],
  added: '2026-10-01',
  size: 100,
  hash: 'abc',
  category: 'CCTP',
  lot: 'Lot 02',
  issuer: '',
  tags: [],
  folder: ''
}
const text = { state: 'ok' as const, text: 'Essais de type 1', mtime: 5 }

function plugin(over: { enabled?: boolean; exclude?: string; entry?: { key: string; passages: unknown[] } }) {
  return {
    settings: { rag: { enabled: over.enabled ?? true, exclude: over.exclude ?? '' } },
    ragIndexer: { ready: over.enabled ?? true },
    ragIndex: { entry: (path: string) => (path === doc.file ? over.entry : undefined) },
    libraryText: { entry: () => text }
  } as never
}

describe('a library document in the vault index', () => {
  it('is said indexed, to reindex, not indexed or left out — nothing when the index is off', () => {
    const key = libraryKey(doc, text, ragFilingWords())
    expect(ragDocState(plugin({ entry: { key, passages: [1, 2, 3] } }), doc)).toEqual({ state: 'indexed', passages: 3 })
    expect(ragDocState(plugin({ entry: { key: 'old', passages: [1] } }), doc)).toEqual({ state: 'stale', passages: 1 })
    expect(ragDocState(plugin({}), doc)).toEqual({ state: 'missing', passages: 0 })
    expect(ragDocState(plugin({ exclude: 'Bibliothèque/_files' }), doc)?.state).toBe('excluded')
    expect(ragDocState(plugin({ enabled: false }), doc)).toBeNull()
  })
})
