import type { App } from 'obsidian'
import { beforeEach, describe, expect, it } from 'vitest'
import { makeFakeApp, type FakeVault } from '../../../test/fakeVault'
import { DEFAULT_SETTINGS, type PMSettings } from '../../types'
import type { HttpTransport } from '../llm'
import { makeRequirement, setText } from './Requirement'
import {
  embeddingText,
  fnv1a,
  packVector,
  readCache,
  ReqEmbeddingIndex,
  splitByCache,
  type EmbeddingCache
} from './ReqEmbeddings'

function req(id: string, fr: string, over: Parameters<typeof makeRequirement>[0] = {}) {
  return setText(makeRequirement({ id, sourceLang: 'fr', ...over }), 'fr', fr, 'franck')
}

describe('fnv1a', () => {
  it('changes when the text changes', () => {
    expect(fnv1a('une exigence')).not.toBe(fnv1a('une exigence.'))
  })

  it('says the same thing about the same text', () => {
    expect(fnv1a('une exigence')).toBe(fnv1a('une exigence'))
  })
})

describe('embeddingText', () => {
  it('embeds the title and the source wording together', () => {
    expect(embeddingText(req('REQ-A-0001', 'La trappe doit ouvrir.', { title: 'Trappe' }))).toBe(
      'trappe la trappe doit ouvrir'
    )
  })

  it('falls back to whatever wording there is when the source was never written', () => {
    const only = setText(makeRequirement({ id: 'REQ-A-0002', sourceLang: 'fr' }), 'en', 'Only English.', 'a')
    expect(embeddingText(only)).toBe('only english')
  })

  it('has nothing for a requirement with nothing written in it', () => {
    expect(embeddingText(makeRequirement({ id: 'REQ-A-0003' }))).toBe('')
  })
})

describe('packVector', () => {
  it('rounds far below what a cosine can tell apart', () => {
    expect(packVector([0.123456789, -0.987654321])).toEqual([0.1235, -0.9877])
  })
})

describe('readCache', () => {
  it('reads what was written', () => {
    const cache: EmbeddingCache = { model: 'm', entries: { 'REQ-A-0001': { hash: 'abc', vector: [1, 0] } } }
    expect(readCache(JSON.stringify(cache))).toEqual(cache)
  })

  it('refuses something that is not a cache rather than half-reading it', () => {
    expect(readCache('not json')).toBeNull()
    expect(readCache('{"entries":{}}')).toBeNull()
    expect(readCache('null')).toBeNull()
  })
})

describe('splitByCache', () => {
  const one = req('REQ-A-0001', 'La trappe doit ouvrir.')
  const two = req('REQ-A-0002', 'Le bus doit tenir.')

  it('keeps a vector whose text has not moved', () => {
    const cache: EmbeddingCache = {
      model: 'm',
      entries: { 'REQ-A-0001': { hash: fnv1a(embeddingText(one)), vector: [1, 0] } }
    }
    const { ready, missing } = splitByCache([one, two], cache, 'm')
    expect(ready.map((item) => item.id)).toEqual(['REQ-A-0001'])
    expect(missing.map((item) => item.id)).toEqual(['REQ-A-0002'])
  })

  // Nobody has to remember to invalidate it: the text is the key.
  it('asks again for a wording that was rewritten', () => {
    const cache: EmbeddingCache = { model: 'm', entries: { 'REQ-A-0001': { hash: 'stale', vector: [1, 0] } } }
    expect(splitByCache([one], cache, 'm').missing.map((item) => item.id)).toEqual(['REQ-A-0001'])
  })

  // Vectors from two models live in different spaces; comparing across them produces
  // numbers that mean nothing at all.
  it('throws away a cache made with another model', () => {
    const cache: EmbeddingCache = {
      model: 'other',
      entries: { 'REQ-A-0001': { hash: fnv1a(embeddingText(one)), vector: [1, 0] } }
    }
    expect(splitByCache([one], cache, 'm').ready).toEqual([])
  })

  it('leaves out a requirement with nothing to embed', () => {
    const empty = makeRequirement({ id: 'REQ-A-0009' })
    const { ready, missing } = splitByCache([empty], null, 'm')
    expect(ready).toEqual([])
    expect(missing).toEqual([])
  })
})

describe('ReqEmbeddingIndex', () => {
  let vault: FakeVault
  let app: App
  let settings: PMSettings
  let calls: { input: string[] }[]
  let index: ReqEmbeddingIndex

  beforeEach(() => {
    const fake = makeFakeApp({ liveMetadataCache: true })
    vault = fake.vault
    app = fake.app as unknown as App
    settings = structuredClone(DEFAULT_SETTINGS)
    settings.llm = { ...settings.llm, enabled: true, baseUrl: 'http://gateway.invalid/v1', modelEmbed: 'emb-1' }
    calls = []
    const transport: HttpTransport = (request) => {
      const body = JSON.parse(request.body ?? '{}') as { input: string[] }
      calls.push(body)
      return Promise.resolve({
        status: 200,
        // A vector per text, made from its length so two different texts differ.
        text: JSON.stringify({ data: body.input.map((text) => ({ embedding: [text.length / 100, 1, 0] })) })
      })
    }
    index = new ReqEmbeddingIndex(app, () => settings, transport)
  })

  it('is unavailable until there is a gateway and a model to embed with', () => {
    expect(index.available).toBe(true)
    settings.llm.modelEmbed = ''
    expect(index.available).toBe(false)
  })

  it('embeds the library and writes the cache beside it', async () => {
    const items = await index.embedAll([req('REQ-A-0001', 'Une.'), req('REQ-A-0002', 'Deux.')])
    expect(items).toHaveLength(2)
    const cache = readCache(vault.contentAt('Requirements/_embeddings.json') ?? '')
    expect(cache?.model).toBe('emb-1')
    expect(Object.keys(cache?.entries ?? {})).toEqual(['REQ-A-0001', 'REQ-A-0002'])
  })

  // The only part that costs anything, so it is paid for once.
  it('asks the gateway nothing on a second run', async () => {
    const library = [req('REQ-A-0001', 'Une.'), req('REQ-A-0002', 'Deux.')]
    await index.embedAll(library)
    calls = []
    const items = await index.embedAll(library)
    expect(calls).toEqual([])
    expect(items).toHaveLength(2)
  })

  it('asks again only for the one that was rewritten', async () => {
    const library = [req('REQ-A-0001', 'Une.'), req('REQ-A-0002', 'Deux.')]
    await index.embedAll(library)
    calls = []
    await index.embedAll([library[0], req('REQ-A-0002', 'Deux, revue.')])
    expect(calls).toHaveLength(1)
    expect(calls[0].input).toHaveLength(1)
  })

  it('sends a large library in batches rather than as one request', async () => {
    const many = Array.from({ length: 70 }, (_, i) => req(`REQ-A-${String(i).padStart(4, '0')}`, `Exigence ${i}.`))
    await index.embedAll(many)
    expect(calls).toHaveLength(3)
    expect(calls[0].input).toHaveLength(32)
  })

  it('stops when the reader asks it to, and keeps what was already paid for', async () => {
    const many = Array.from({ length: 70 }, (_, i) => req(`REQ-A-${String(i).padStart(4, '0')}`, `Exigence ${i}.`))
    let batches = 0
    await index.embedAll(
      many,
      () => {
        batches += 1
      },
      () => batches > 1
    )
    const cache = readCache(vault.contentAt('Requirements/_embeddings.json') ?? '')
    expect(Object.keys(cache?.entries ?? {}).length).toBeGreaterThan(0)
    expect(Object.keys(cache?.entries ?? {}).length).toBeLessThan(70)
  })
})
