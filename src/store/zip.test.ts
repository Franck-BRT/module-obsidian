import { describe, expect, it } from 'vitest'
import { readZipEntries } from '../../test/readZip'
import { crc32, utf8, zip } from './zip'

/** The archive read back the way an unzipper reads it, and never the way it was written. */
const readZip = (bytes: Uint8Array): { name: string; text: string }[] =>
  readZipEntries(bytes).map((entry) => {
    expect(entry.ok).toBe(true)
    return { name: entry.name, text: entry.text }
  })

describe('crc32', () => {
  // The one value every CRC-32 implementation is checked against.
  it('agrees with the rest of the world on "123456789"', () => {
    expect(crc32(utf8('123456789'))).toBe(0xcbf43926)
  })

  it('has a value for nothing at all', () => {
    expect(crc32(new Uint8Array())).toBe(0)
  })
})

describe('zip', () => {
  const made = () =>
    zip(
      [
        { name: 'hello.txt', data: utf8('Bonjour, monde.') },
        { name: 'deep/inside.xml', data: utf8('<a>é</a>') }
      ],
      new Date('2026-09-22T10:20:30Z')
    )

  it('starts with the signature a reader looks for', () => {
    expect(Array.from(made().slice(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04])
  })

  it('comes back out entry by entry, checked against its own pointers', () => {
    expect(readZip(made())).toEqual([
      { name: 'hello.txt', text: 'Bonjour, monde.' },
      { name: 'deep/inside.xml', text: '<a>é</a>' }
    ])
  })

  // Accented text is longer in bytes than in characters, and an archive that measured it
  // in characters would hand every reader the wrong offset for everything after it.
  it('measures an entry in bytes rather than in characters', () => {
    const [entry] = readZip(zip([{ name: 'a.txt', data: utf8('éé') }]))
    expect(entry.text).toBe('éé')
  })

  // The same document exported twice in one minute is the same file, which is what makes
  // an export diffable at all.
  it('writes the same bytes for the same content and the same moment', () => {
    expect(made()).toEqual(made())
  })

  it('has something to write even when there is nothing in it', () => {
    const empty = zip([])
    expect(Array.from(empty.slice(0, 4))).toEqual([0x50, 0x4b, 0x05, 0x06])
  })
})
