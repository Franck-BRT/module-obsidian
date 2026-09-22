/**
 * Reading an archive back through its own pointers.
 *
 * Not by asking the writer where it put things — that would agree with itself whatever it
 * did — but the way an unzipper does: find the end record, follow it to the central
 * directory, follow each entry to its local header, and check the bytes against the CRC
 * written for them. Shared by every test that writes a ZIP, which is now three formats.
 */

const table = (() => {
  const made = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let value = i
    for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    made[i] = value >>> 0
  }
  return made
})()

function crc(data: Uint8Array): number {
  let value = 0xffffffff
  for (const byte of data) value = table[(value ^ byte) & 0xff] ^ (value >>> 8)
  return (value ^ 0xffffffff) >>> 0
}

export interface ZipRead {
  name: string
  text: string
  /** Everything the archive says about this entry that a reader has to agree on. */
  ok: boolean
}

export function readZipEntries(bytes: Uint8Array): ZipRead[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const eocd = bytes.length - 22
  if (view.getUint32(eocd, true) !== 0x06054b50) throw new Error('no end record')
  if (view.getUint32(eocd + 16, true) + view.getUint32(eocd + 12, true) !== eocd) throw new Error('directory misplaced')

  const out: ZipRead[] = []
  let at = view.getUint32(eocd + 16, true)
  for (let i = 0; i < view.getUint16(eocd + 10, true); i++) {
    if (view.getUint32(at, true) !== 0x02014b50) throw new Error('no directory entry')
    const declared = view.getUint32(at + 16, true)
    const size = view.getUint32(at + 24, true)
    const nameLength = view.getUint16(at + 28, true)
    const offset = view.getUint32(at + 42, true)
    const name = new TextDecoder().decode(bytes.slice(at + 46, at + 46 + nameLength))

    const local = view.getUint32(offset, true) === 0x04034b50
    const agrees =
      view.getUint32(offset + 14, true) === declared &&
      view.getUint32(offset + 18, true) === size &&
      view.getUint32(offset + 22, true) === size
    const start = offset + 30 + view.getUint16(offset + 26, true) + view.getUint16(offset + 28, true)
    const data = bytes.slice(start, start + size)
    out.push({ name, text: new TextDecoder().decode(data), ok: local && agrees && crc(data) === declared })
    at += 46 + nameLength
  }
  return out
}
