import { describe, expect, it } from 'vitest'
import { crc32, utf8, zip } from './zip'

/**
 * Reading an archive back through its own pointers.
 *
 * Not by asking the writer where it put things — that would agree with itself whatever
 * it did — but the way an unzipper does: find the end record, follow it to the central
 * directory, follow each entry to its local header, and check the bytes against the CRC
 * that was written for them.
 */
function readZip(bytes: Uint8Array): { name: string; text: string }[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const eocd = bytes.length - 22
  expect(view.getUint32(eocd, true)).toBe(0x06054b50)
  const count = view.getUint16(eocd + 10, true)
  expect(view.getUint32(eocd + 16, true) + view.getUint32(eocd + 12, true)).toBe(eocd)

  const out: { name: string; text: string }[] = []
  let at = view.getUint32(eocd + 16, true)
  for (let i = 0; i < count; i++) {
    expect(view.getUint32(at, true)).toBe(0x02014b50)
    const crc = view.getUint32(at + 16, true)
    const size = view.getUint32(at + 24, true)
    const nameLength = view.getUint16(at + 28, true)
    const offset = view.getUint32(at + 42, true)
    const name = new TextDecoder().decode(bytes.slice(at + 46, at + 46 + nameLength))

    expect(view.getUint32(offset, true)).toBe(0x04034b50)
    // The local header says it again, and an unzipper believes that copy: the two
    // disagreeing is an archive that reads correctly here and nowhere else.
    expect(view.getUint32(offset + 14, true)).toBe(crc)
    expect(view.getUint32(offset + 18, true)).toBe(size)
    expect(view.getUint32(offset + 22, true)).toBe(size)
    const start = offset + 30 + view.getUint16(offset + 26, true) + view.getUint16(offset + 28, true)
    const data = bytes.slice(start, start + size)
    expect(crc32(data)).toBe(crc)
    out.push({ name, text: new TextDecoder().decode(data) })
    at += 46 + nameLength
  }
  return out
}

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
