import { describe, expect, it } from 'vitest'
import { readSeverity, readVerdict, readVisaReply, verdictFor, visaRequest, type VisaInput } from './visaSheet'

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
