import { describe, expect, it } from 'vitest'
import type { ChatRequest } from '../llm'
import {
  batches,
  glossaryFor,
  parseGlossary,
  readBatch,
  readSingle,
  translateTexts,
  TranslationStopped
} from './translateTexts'

const NOTE = `---
type: glossaire
---
# Glossaire de traduction

Termes pour toutes les langues :
- CNES
- ECSS-E-ST-10C

## Vers le français
| Anglais | Français |
| --- | --- |
| shall | doit |
| **should** | devrait |
- contractor → titulaire
- Design Review = revue de conception
- launcher : lanceur

## English
- titulaire -> contractor
`

describe('the glossary', () => {
  it('reads tables, arrows, equals, list items and terms to keep, by language', () => {
    const entries = parseGlossary(NOTE)
    expect(entries).toEqual([
      { source: 'CNES', target: 'CNES', language: '' },
      { source: 'ECSS-E-ST-10C', target: 'ECSS-E-ST-10C', language: '' },
      { source: 'shall', target: 'doit', language: 'fr' },
      { source: 'should', target: 'devrait', language: 'fr' },
      { source: 'contractor', target: 'titulaire', language: 'fr' },
      { source: 'Design Review', target: 'revue de conception', language: 'fr' },
      { source: 'launcher', target: 'lanceur', language: 'fr' },
      { source: 'titulaire', target: 'contractor', language: 'en' }
    ])
  })

  it('gives only the terms for the language that the text uses', () => {
    const entries = parseGlossary(NOTE)
    const terms = glossaryFor(entries, 'fr', 'The Contractor shall deliver the CNES report.')
    expect(terms.map((one) => one.source)).toEqual(['CNES', 'shall', 'contractor'])
    expect(glossaryFor(entries, 'en', 'Le titulaire livre.').map((one) => one.source)).toEqual(['titulaire'])
  })
})

describe('the batches', () => {
  it('hold no more than their size or count, a long text alone', () => {
    expect(batches(['aaaa', 'bbbb', 'cccc'], 8)).toEqual([['aaaa', 'bbbb'], ['cccc']])
    expect(batches(['a', 'b', 'c'], 100, 2)).toEqual([['a', 'b'], ['c']])
    expect(batches(['x'.repeat(50), 'y'], 10)).toEqual([['x'.repeat(50)], ['y']])
  })

  it('are read back by number, or not at all when one is missing', () => {
    expect(readBatch('```json\n{"1": "Un", "2": "Deux"}\n```', 2)).toEqual(['Un', 'Deux'])
    expect(readBatch('{"1": "Un"}', 2)).toBeNull()
    expect(readBatch('pas du JSON', 1)).toBeNull()
    expect(readSingle('« Bonjour »')).toBe('Bonjour')
  })
})

describe('a document’s texts translated', () => {
  const fake = (answer: (request: ChatRequest) => string) => {
    const asked: ChatRequest[] = []
    return {
      asked,
      chat: (request: ChatRequest) => {
        asked.push(request)
        return Promise.resolve(answer(request))
      }
    }
  }

  it('are asked by batch, with the glossary’s terms they use, and told as they come', async () => {
    const client = fake((request) => {
      const numbered = JSON.parse(request.messages[1].content) as Record<string, string>
      return JSON.stringify(Object.fromEntries(Object.entries(numbered).map(([key, text]) => [key, `FR:${text}`])))
    })
    const seen: number[] = []
    const out = await translateTexts(
      client,
      ['The contractor shall.', 'Scope'],
      { model: 'm', to: 'fr', glossary: parseGlossary(NOTE) },
      (done) => seen.push(done)
    )
    expect(out.get('Scope')).toBe('FR:Scope')
    expect(client.asked).toHaveLength(1)
    expect(client.asked[0].messages[0].content).toContain('contractor → titulaire')
    expect(client.asked[0].messages[0].content).not.toContain('launcher')
    expect(client.asked[0].messages[0].content).toContain('French')
    expect(seen).toEqual([0, 2])
  })

  it('are asked one by one when a batch comes back wrong', async () => {
    const client = fake((request) =>
      request.messages[1].content.startsWith('{') ? '{"1": "seulement un"}' : 'Traduit'
    )
    const out = await translateTexts(client, ['One', 'Two'], { model: 'm', to: 'fr', glossary: [] })
    expect([...out.values()]).toEqual(['Traduit', 'Traduit'])
    expect(client.asked).toHaveLength(3)
  })

  it('stop when told to', async () => {
    const client = fake(() => '{"1": "x"}')
    await expect(
      translateTexts(client, ['One'], { model: 'm', to: 'fr', glossary: [] }, undefined, () => true)
    ).rejects.toBeInstanceOf(TranslationStopped)
  })
})

describe('the glossary note the plugin makes', () => {
  it('holds only its example terms, in either language', async () => {
    const { setLocale, t } = await import('../../i18n')
    for (const locale of ['fr', 'en'] as const) {
      setLocale(locale)
      expect(parseGlossary(t('translate.glossaryTemplate'))).toEqual([
        { source: 'CNES', target: 'CNES', language: '' },
        { source: 'ECSS', target: 'ECSS', language: '' },
        { source: 'shall', target: 'doit', language: 'fr' },
        { source: 'should', target: 'devrait', language: 'fr' },
        { source: 'contractor', target: 'titulaire', language: 'fr' },
        { source: 'titulaire', target: 'contractor', language: 'en' }
      ])
    }
  })
})
