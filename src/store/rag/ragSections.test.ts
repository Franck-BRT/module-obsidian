import { describe, expect, it } from 'vitest'
import { RagIndex } from './RagIndex'
import { searchVault, SEARCH_DEFAULTS } from './ragSearch'
import { entryText } from './ragSections'
import { MemoryStorage, source, wordEmbedder } from './ragTestKit'

const filler = (n: string): string =>
  `Les essais sont conduits selon la procédure qualité du titulaire et consignés dans un procès-verbal, ${n}. `.repeat(
    8
  )

const spec = [
  '# SPÉCIFICATION',
  '',
  '## 2. DÉFINITIONS',
  '',
  'Essais de type 1 : essais sur le premier équipement de série, voir paragraphe 6.3.5.',
  '',
  '### 6.3.4 ESSAIS EN USINE',
  '',
  filler('usine'),
  '',
  '### 6.3.5 ESSAIS DE TYPE 1',
  '',
  'Les essais de type 1 qualifient la conception de l’équipement, une fois, en présence du client.',
  '',
  filler('type 1'),
  '',
  'Critères d’acceptation : aucun claquage, échauffement sous les limites.',
  '',
  '### 6.3.6 ESSAIS DE TYPE 2',
  '',
  filler('série')
].join('\n')

async function built(): Promise<RagIndex> {
  const index = new RagIndex(new MemoryStorage())
  await index.update(
    [
      source('Library/_files/Spec.pdf', spec, { kind: 'document' }),
      source('Notes/CR.md', 'Compte rendu : les essais avancent.'),
      source('Library/_files/Autre.pdf', 'Rien sur les essais de type 1 ici.', { kind: 'document' })
    ],
    wordEmbedder(),
    { model: 'test' }
  )
  return index
}

describe('the vault search, by sections', () => {
  it('puts a source back together, its headings as lines', async () => {
    const index = await built()
    const text = entryText(index.entry('Library/_files/Spec.pdf')!)
    expect(text).toContain('#### 6.3.5 ESSAIS DE TYPE 1')
    expect(text).toContain('Critères d’acceptation')
  })

  it('gives the section named by its number, or by its heading, whole and first', async () => {
    const index = await built()
    for (const query of ['que dit le paragraphe 6.3.5 ?', 'donne-moi la définition complète des essais de type 1']) {
      const { found } = await searchVault(index, query, {}, SEARCH_DEFAULTS)
      const spec = found.find((one) => one.entry.path === 'Library/_files/Spec.pdf')
      expect(spec?.passages[0].text.startsWith('#### 6.3.5 ESSAIS DE TYPE 1')).toBe(true)
      expect(spec?.passages[0].text).toContain('Critères d’acceptation')
      expect(spec?.passages[0].text).not.toContain('6.3.6')
    }
  })

  it('is held to the sources asked for', async () => {
    const index = await built()
    const { found } = await searchVault(
      index,
      'essais de type 1',
      {},
      { ...SEARCH_DEFAULTS, only: ['Library/_files/Autre.pdf'] }
    )
    expect(found.map((one) => one.entry.path)).toEqual(['Library/_files/Autre.pdf'])
  })
})
