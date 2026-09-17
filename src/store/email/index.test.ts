import { describe, expect, it } from 'vitest'
import { isEmailFile, parseEmail } from './index'
import { buildCompoundFile, utf16 } from './buildMsg.fixture'

const eml = new TextEncoder().encode('Subject: Devis\r\nFrom: a@b.fr\r\n\r\nLe devis est joint.\r\n')

describe('deciding what a dropped file is', () => {
  it('takes only a message by its name', () => {
    expect(isEmailFile('Relance.msg')).toBe(true)
    expect(isEmailFile('Relance.EML')).toBe(true)
    expect(isEmailFile('plan.pdf')).toBe(false)
    expect(isEmailFile('notes.md')).toBe(false)
  })

  it('reads a .msg by its signature, whatever it is called', () => {
    const bytes = buildCompoundFile([{ name: '__substg1.0_0037001F', data: utf16('Réunion') }])
    expect(parseEmail('sans-extension', bytes)?.subject).toBe('Réunion')
  })

  it('reads an .eml as text', () => {
    expect(parseEmail('Devis.eml', eml)).toMatchObject({ subject: 'Devis', from: 'a@b.fr' })
  })

  it('gives nothing for a file that is not a message', () => {
    expect(parseEmail('plan.pdf', new TextEncoder().encode('%PDF-1.7'))).toBeNull()
    // Named like a message, but carrying no headers at all.
    expect(parseEmail('faux.eml', new TextEncoder().encode('juste du texte'))).toBeNull()
  })

  it('gives nothing rather than throwing on a truncated .msg', () => {
    const bytes = buildCompoundFile([{ name: '__substg1.0_0037001F', data: utf16('x') }])
    expect(parseEmail('coupe.msg', bytes.subarray(0, 600))).toBeNull()
  })
})
