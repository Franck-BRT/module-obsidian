import { describe, expect, it } from 'vitest'
import { buildCompoundFile, filetime, propertyStream, utf16, type FixtureStream } from './buildMsg.fixture'
import { looksLikeCfb, readCfb } from './cfb'
import { fromFiletime, parseMsg } from './parseMsg'

const unicode = (tag: string, text: string): FixtureStream => ({
  name: `__substg1.0_${tag}001F`,
  data: utf16(text)
})

const sample = (over: FixtureStream[] = []): Uint8Array =>
  buildCompoundFile([
    unicode('0037', 'Réunion de chantier — lot 3'),
    unicode('1000', 'Bonjour,\r\n\r\nLa réunion est déplacée au 22.'),
    unicode('0C1A', 'Jean Dupont'),
    unicode('5D01', 'jean.dupont@example.fr'),
    unicode('0E04', 'Franck; Marie Martin'),
    unicode('0E03', 'Direction'),
    {
      name: '__properties_version1.0',
      data: propertyStream([{ tag: 0x0039, type: 0x0040, value: filetime('2026-09-15T08:12:00Z') }])
    },
    ...over
  ])

describe('the compound file a .msg is', () => {
  it('is recognised by its signature, and nothing else is', () => {
    expect(looksLikeCfb(sample())).toBe(true)
    expect(looksLikeCfb(new TextEncoder().encode('From: x\n\nplain text'))).toBe(false)
    expect(looksLikeCfb(new Uint8Array(4))).toBe(false)
  })

  it('finds every stream hanging off the root', () => {
    const file = readCfb(sample())
    expect(file.entries.has('__substg1.0_0037001F')).toBe(true)
    expect(file.entries.has('__properties_version1.0')).toBe(true)
  })

  it('reads a stream that spans several mini sectors', () => {
    // 64 bytes to a mini sector, so anything past a line or two is already chained.
    const long = 'x'.repeat(500)
    const file = readCfb(buildCompoundFile([unicode('1000', long)]))
    const entry = file.entries.get('__substg1.0_1000001F')
    if (!entry) throw new Error('stream missing')
    expect(new TextDecoder('utf-16le').decode(file.read(entry))).toBe(long)
  })

  it('refuses anything that is not one', () => {
    expect(() => readCfb(new TextEncoder().encode('Subject: x'))).toThrow('Not a compound file')
  })
})

describe('reading an Outlook .msg', () => {
  it('reads the envelope, the text and the day it was sent', () => {
    const mail = parseMsg(sample())
    expect(mail.subject).toBe('Réunion de chantier — lot 3')
    expect(mail.from).toBe('Jean Dupont <jean.dupont@example.fr>')
    expect(mail.to).toEqual(['Franck; Marie Martin'])
    expect(mail.cc).toEqual(['Direction'])
    expect(mail.date).toBe('2026-09-15')
    expect(mail.body).toContain('La réunion est déplacée au 22.')
  })

  it('falls back to the HTML body when there is no plain one', () => {
    const file = buildCompoundFile([
      unicode('0037', 'Sans texte'),
      { name: '__substg1.0_10130102', data: new TextEncoder().encode('<p>Bonjour</p><p>Merci</p>') }
    ])
    expect(parseMsg(file).body).toBe('Bonjour\n\nMerci')
  })

  it('reads a property written as ASCII rather than unicode', () => {
    const file = buildCompoundFile([{ name: '__substg1.0_0037001E', data: new TextEncoder().encode('Sujet simple') }])
    expect(parseMsg(file).subject).toBe('Sujet simple')
  })

  it('uses the sender address when the message gives no display name', () => {
    const file = buildCompoundFile([unicode('0C1F', 'jean@example.fr')])
    expect(parseMsg(file).from).toBe('jean@example.fr')
  })

  it('leaves the date empty rather than inventing one', () => {
    expect(parseMsg(buildCompoundFile([unicode('0037', 'x')])).date).toBe('')
  })

  it('reads a message with nothing in it at all', () => {
    const mail = parseMsg(buildCompoundFile([]))
    expect(mail).toMatchObject({ subject: '', from: '', body: '', date: '' })
  })
})

describe('a Windows FILETIME', () => {
  it('lands on the same day it started from', () => {
    expect(fromFiletime(filetime('2026-09-15T08:12:00Z'))).toBe('2026-09-15')
    expect(fromFiletime(filetime('2001-01-01T00:00:00Z'))).toBe('2001-01-01')
  })

  it('gives nothing for a property that was never set', () => {
    expect(fromFiletime(0n)).toBe('')
  })
})

describe('the files a message carries', () => {
  const body = (text: string): FixtureStream => ({ name: '__substg1.0_1000001F', data: utf16(text) })

  it('reads an attachment out of its own storage', () => {
    const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37])
    const msg = buildCompoundFile([
      { name: '__substg1.0_0037001F', data: utf16('Devis') },
      body('Ci-joint.'),
      {
        name: '__attach_version1.0_#00000000',
        children: [
          { name: '__substg1.0_3707001F', data: utf16('Devis toiture.pdf') },
          { name: '__substg1.0_370E001F', data: utf16('application/pdf') },
          { name: '__substg1.0_37010102', data: pdf }
        ]
      }
    ])
    const mail = parseMsg(msg)
    expect(mail.attachments).toHaveLength(1)
    expect(mail.attachments[0]).toMatchObject({ name: 'Devis toiture.pdf', mime: 'application/pdf', size: 8 })
    expect(Array.from(mail.attachments[0].bytes ?? [])).toEqual(Array.from(pdf))
  })

  it('reads every attachment, not only the first', () => {
    const msg = buildCompoundFile([
      body('Deux pièces jointes.'),
      {
        name: '__attach_version1.0_#00000000',
        children: [
          { name: '__substg1.0_3707001F', data: utf16('a.pdf') },
          { name: '__substg1.0_37010102', data: new Uint8Array([1, 2]) }
        ]
      },
      {
        name: '__attach_version1.0_#00000001',
        children: [
          { name: '__substg1.0_3707001F', data: utf16('b.xlsx') },
          { name: '__substg1.0_37010102', data: new Uint8Array([3, 4, 5]) }
        ]
      }
    ])
    expect(parseMsg(msg).attachments.map((a) => a.name)).toEqual(['a.pdf', 'b.xlsx'])
  })

  /** Older clients write the 8.3 name only; a worse name beats no name. */
  it('falls back to the short name, then to something rather than nothing', () => {
    const shortOnly = buildCompoundFile([
      body('x'),
      {
        name: '__attach_version1.0_#00000000',
        children: [
          { name: '__substg1.0_3704001F', data: utf16('DEVIS~1.PDF') },
          { name: '__substg1.0_37010102', data: new Uint8Array([1]) }
        ]
      }
    ])
    expect(parseMsg(shortOnly).attachments[0].name).toBe('DEVIS~1.PDF')

    const nameless = buildCompoundFile([
      body('x'),
      {
        name: '__attach_version1.0_#00000000',
        children: [
          { name: '__substg1.0_3703001F', data: utf16('.pdf') },
          { name: '__substg1.0_37010102', data: new Uint8Array([1]) }
        ]
      }
    ])
    expect(parseMsg(nameless).attachments[0].name).toBe('attachment.pdf')
  })

  /** A name with nothing behind it invites a click that can only fail. */
  it('skips an attachment whose bytes are not there', () => {
    const msg = buildCompoundFile([
      body('x'),
      {
        name: '__attach_version1.0_#00000000',
        children: [{ name: '__substg1.0_3707001F', data: utf16('fantome.pdf') }]
      }
    ])
    expect(parseMsg(msg).attachments).toEqual([])
  })

  it('says a message carries nothing when it carries nothing', () => {
    expect(parseMsg(buildCompoundFile([body('Rien de joint.')])).attachments).toEqual([])
  })
})
