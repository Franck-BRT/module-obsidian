import { describe, expect, it } from 'vitest'
import {
  numberObservations,
  openObservations,
  readSeverity,
  readVerdict,
  readVisaReply,
  verdictFor,
  visaRequest,
  type VisaInput
} from './visaSheet'

const input: VisaInput = {
  document: {
    title: 'Note de calcul radier',
    reference: 'NDC-04',
    issue: 'B',
    issuer: 'Garonne Bâtiment',
    file: 'NDC-04 ind B.pdf',
    text: 'Béton C25/30. Enrobage 30 mm. Charge d’exploitation 2,5 kN/m².'
  },
  references: [{ name: 'CCTP Lot 02', text: 'Art. 3.2 — Béton C30/37 XC2. Art. 3.4 — Enrobage minimal 40 mm.' }],
  requirements: [{ id: 'REQ-012', title: 'Exposition', text: 'Les bétons du radier sont de classe XC2.' }],
  language: 'fr'
}

describe('the question', () => {
  it('holds the document, the references and the requirements, and asks for the sheet in the language', () => {
    const request = visaRequest('m', input)
    const [system, user] = request.messages
    expect(system.content).toContain('French')
    expect(system.content).toContain('"severity"')
    expect(user.content).toContain('Reference: NDC-04')
    expect(user.content).toContain('## CCTP Lot 02')
    expect(user.content).toContain('- REQ-012 — Exposition : Les bétons du radier sont de classe XC2.')
    expect(request.temperature).toBe(0)
  })

  it('cuts long texts to the budget, saying so', () => {
    const long = { ...input, document: { ...input.document, text: 'x'.repeat(100_000) } }
    const user = visaRequest('m', long, 10_000).messages[1].content
    expect(user.length).toBeLessThan(12_000)
    expect(user).toContain('[…]')
  })
})

describe('the reply', () => {
  it('is read into observations, its verdict held to them', () => {
    const sheet = readVisaReply(
      '```json\n' +
        JSON.stringify({
          verdict: 'VAO',
          summary: 'Classe de béton et enrobage non conformes.',
          observations: [
            {
              article: '§ 2.1',
              observation: 'C25/30 au lieu de C30/37 XC2.',
              severity: 'bloquante',
              source: 'CCTP art. 3.2'
            },
            { article: '§ 2.3', observation: 'Enrobage 30 mm < 40 mm.', severity: 'majeure', source: 'CCTP art. 3.4' },
            { article: '', observation: '', severity: 'minor', source: '' }
          ]
        }) +
        '\n```'
    )
    expect(sheet?.observations).toHaveLength(2)
    expect(sheet?.observations[0]).toMatchObject({ severity: 'blocking', source: 'CCTP art. 3.2' })
    // Said « with observations », but one is blocking: refused.
    expect(sheet?.verdict).toBe('rejected')
    expect(readVisaReply('pas de JSON')).toBeNull()
  })

  it('reads severities and verdicts in either language', () => {
    expect(['Mineure', 'major', 'Bloquant', '?'].map(readSeverity)).toEqual(['minor', 'major', 'blocking', 'minor'])
    expect(['VSO', 'vao', 'Refusé', 'approved with comments', 'peut-être'].map(readVerdict)).toEqual([
      'approved',
      'observations',
      'rejected',
      'observations',
      null
    ])
    expect(verdictFor([])).toBe('approved')
    expect(verdictFor([{ severity: 'major' }])).toBe('observations')
  })
})

describe('a later issue', () => {
  const previous = [
    {
      ref: 'B1',
      article: '§ 2.1',
      observation: 'C25/30 au lieu de C30/37 XC2.',
      severity: 'blocking' as const,
      source: 'CCTP 3.2',
      state: 'open' as const,
      note: ''
    },
    {
      ref: 'B2',
      article: '§ 2.3',
      observation: 'Enrobage 30 mm < 40 mm.',
      severity: 'major' as const,
      source: 'CCTP 3.4',
      state: 'open' as const,
      note: ''
    },
    {
      ref: 'B3',
      article: '§ 4',
      observation: 'Charge des locaux techniques.',
      severity: 'minor' as const,
      source: '',
      state: 'open' as const,
      note: ''
    }
  ]

  it('is asked where each earlier observation stands, and not to raise them again', () => {
    const request = visaRequest('m', { ...input, previous: { issue: 'B', observations: previous } })
    expect(request.messages[0].content).toContain('"previous"')
    expect(request.messages[1].content).toContain('# Observations still open on the review of issue B')
    expect(request.messages[1].content).toContain('- B2 [major] (§ 2.3) : Enrobage 30 mm < 40 mm.')
  })

  it('reads each one’s state, keeps those not said open, and counts those not lifted in the verdict', () => {
    const sheet = readVisaReply(
      JSON.stringify({
        verdict: 'approved',
        summary: 'Béton et charges corrigés.',
        previous: [
          { ref: 'b1', state: 'levée', note: 'C30/37 XC2 retenu.' },
          { ref: 'B2', state: 'partiellement levée', note: '35 mm en rive.' }
        ],
        observations: []
      }),
      previous
    )
    expect(sheet?.carried?.map((one) => [one.ref, one.state, one.note])).toEqual([
      ['B1', 'lifted', 'C30/37 XC2 retenu.'],
      ['B2', 'partial', '35 mm en rive.'],
      ['B3', 'open', '']
    ])
    // Said approved, but B2 and B3 still stand.
    expect(sheet?.verdict).toBe('observations')
    expect(verdictFor([], [{ severity: 'blocking', state: 'lifted' }])).toBe('approved')
  })

  it('numbers new observations by their issue, and reads a note’s kept ones back, the lifted ones dropped', () => {
    expect(numberObservations('C', [{ article: '', observation: 'x', severity: 'minor', source: '' }])[0].ref).toBe(
      'C1'
    )
    expect(
      openObservations([
        { ref: 'B1', observation: 'a', severity: 'blocking', state: 'lifted' },
        { ref: 'B2', observation: 'b', severity: 'majeure', state: 'partial', note: 'en rive' },
        { ref: 'C1', observation: 'c', severity: 'minor', state: 'open' },
        { ref: 'C2', observation: '' }
      ]).map((one) => [one.ref, one.severity, one.state])
    ).toEqual([
      ['B2', 'major', 'partial'],
      ['C1', 'minor', 'open']
    ])
  })
})
