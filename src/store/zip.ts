/**
 * A ZIP archive, written by hand.
 *
 * Because a `.docx` is a ZIP of XML parts, and this plugin ships no runtime
 * dependencies: every exchange format here — CSV, ReqIF, now Word — is written out by
 * code that can be read in one sitting rather than pulled in as a library whose licence,
 * size and upstream have to be answered for.
 *
 * Everything is stored uncompressed. The format allows it, Word accepts it, and it means
 * no deflate implementation: a requirements document is tens of kilobytes of text, and
 * the honest trade is a file twice the size against a dependency nobody audits.
 */

export interface ZipEntry {
  /** The path inside the archive, forward slashes, no leading one. */
  name: string
  data: Uint8Array
}

const table = (() => {
  const made = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let value = i
    for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    made[i] = value >>> 0
  }
  return made
})()

export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of data) crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

export function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}

/**
 * The date as MS-DOS wrote them in 1980, which is what a ZIP entry carries.
 *
 * Two-second resolution and no timezone, so the same document exported twice in one
 * minute gives the same bytes. Anything before 1980 cannot be said at all and is clamped
 * rather than wrapped into a date that would read as the future.
 */
function dosStamp(at: Date): { time: number; date: number } {
  const year = Math.max(1980, at.getFullYear())
  return {
    time: (at.getHours() << 11) | (at.getMinutes() << 5) | (at.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((at.getMonth() + 1) << 5) | at.getDate()
  }
}

class Writer {
  private parts: number[] = []

  byte(value: number): void {
    this.parts.push(value & 0xff)
  }

  short(value: number): void {
    this.byte(value)
    this.byte(value >>> 8)
  }

  long(value: number): void {
    this.short(value)
    this.short(value >>> 16)
  }

  bytes(data: Uint8Array): void {
    for (const byte of data) this.parts.push(byte)
  }

  get length(): number {
    return this.parts.length
  }

  done(): Uint8Array {
    return Uint8Array.from(this.parts)
  }
}

/** The archive, as the bytes of a file. */
export function zip(entries: ZipEntry[], at = new Date()): Uint8Array {
  const stamp = dosStamp(at)
  const out = new Writer()
  const central: { name: Uint8Array; crc: number; size: number; offset: number }[] = []

  for (const entry of entries) {
    const name = utf8(entry.name)
    const crc = crc32(entry.data)
    central.push({ name, crc, size: entry.data.length, offset: out.length })
    out.long(0x04034b50)
    // Version 2.0 and no flags: stored, no encryption, no data descriptor. A reader that
    // needs anything beyond that is reading a file this does not write.
    out.short(20)
    out.short(0)
    out.short(0)
    out.short(stamp.time)
    out.short(stamp.date)
    out.long(crc)
    out.long(entry.data.length)
    out.long(entry.data.length)
    out.short(name.length)
    out.short(0)
    out.bytes(name)
    out.bytes(entry.data)
  }

  const directory = out.length
  for (const entry of central) {
    out.long(0x02014b50)
    out.short(20)
    out.short(20)
    out.short(0)
    out.short(0)
    out.short(stamp.time)
    out.short(stamp.date)
    out.long(entry.crc)
    out.long(entry.size)
    out.long(entry.size)
    out.short(entry.name.length)
    out.short(0)
    out.short(0)
    out.short(0)
    out.short(0)
    out.long(0)
    out.long(entry.offset)
    out.bytes(entry.name)
  }

  // Measured before the end record is written, not after: its own bytes are not part of
  // the directory it is describing.
  const directoryEnd = out.length
  out.long(0x06054b50)
  out.short(0)
  out.short(0)
  out.short(central.length)
  out.short(central.length)
  out.long(directoryEnd - directory)
  out.long(directory)
  out.short(0)
  return out.done()
}
