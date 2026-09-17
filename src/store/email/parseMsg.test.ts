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
