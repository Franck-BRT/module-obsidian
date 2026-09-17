/**
 * A compound file built byte by byte, so the reader can be tested against a real
 * container rather than a mock of one.
 *
 * Test scaffolding, not shipped behaviour: it writes the shape a `.msg` has — 512-byte
 * sectors, small streams packed into the mini stream — and nothing more. Its limit is
 * worth stating plainly: a reader tested only against a writer of its own can still agree
 * with it about something the specification says differently.
 */

const END_OF_CHAIN = 0xfffffffe
const FAT_SECTOR = 0xfffffffd
const FREE = 0xffffffff
const SECTOR = 512
const MINI = 64
const DIR_PER_SECTOR = SECTOR / 128

export interface FixtureStream {
  name: string
  data: Uint8Array
}

export function utf16(text: string): Uint8Array {
  const out = new Uint8Array(text.length * 2)
  const view = new DataView(out.buffer)
  for (let i = 0; i < text.length; i++) view.setUint16(i * 2, text.charCodeAt(i), true)
  return out
}

/** A FILETIME: 100-nanosecond ticks since 1601, which is how Windows stores a date. */
export function filetime(iso: string): bigint {
  return (BigInt(Date.parse(iso)) + 11_644_473_600_000n) * 10_000n
}

/** The fixed-length property stream: a 32-byte header, then 16 bytes per property. */
export function propertyStream(props: { tag: number; type: number; value: bigint }[]): Uint8Array {
  const out = new Uint8Array(32 + props.length * 16)
  const view = new DataView(out.buffer)
  props.forEach((prop, i) => {
    const at = 32 + i * 16
    view.setUint32(at, (prop.tag << 16) | prop.type, true)
    view.setUint32(at + 4, 6, true)
    view.setBigUint64(at + 8, prop.value, true)
  })
  return out
}

export function buildCompoundFile(streams: FixtureStream[]): Uint8Array {
  // Every stream here is small, so they all live in the mini stream.
  const miniSectorsOf = (size: number) => Math.max(1, Math.ceil(size / MINI))
  let miniCursor = 0
  const placed = streams.map((stream) => {
    const start = miniCursor
    miniCursor += miniSectorsOf(stream.data.length)
    return { ...stream, start }
  })
  const miniStream = new Uint8Array(miniCursor * MINI)
  for (const stream of placed) miniStream.set(stream.data, stream.start * MINI)

  const dirSectors = Math.ceil((placed.length + 1) / DIR_PER_SECTOR)
  const miniStreamSectors = Math.ceil(miniStream.length / SECTOR) || 1
  // 0: FAT · 1..: directory · then the mini FAT · then the mini stream itself.
  const dirStart = 1
  const miniFatStart = dirStart + dirSectors
  const miniStreamStart = miniFatStart + 1
  const totalSectors = miniStreamStart + miniStreamSectors

  const fat = new Uint32Array(SECTOR / 4).fill(FREE)
  fat[0] = FAT_SECTOR
  for (let i = 0; i < dirSectors; i++) fat[dirStart + i] = i === dirSectors - 1 ? END_OF_CHAIN : dirStart + i + 1
  fat[miniFatStart] = END_OF_CHAIN
  for (let i = 0; i < miniStreamSectors; i++) {
    fat[miniStreamStart + i] = i === miniStreamSectors - 1 ? END_OF_CHAIN : miniStreamStart + i + 1
  }

  // Each stream's mini sectors run consecutively, so the chain is i → i+1 and stops.
  const miniFat = new Uint32Array(SECTOR / 4).fill(FREE)
  for (const stream of placed) {
    const count = miniSectorsOf(stream.data.length)
    for (let i = 0; i < count; i++) {
      miniFat[stream.start + i] = i === count - 1 ? END_OF_CHAIN : stream.start + i + 1
    }
  }

  const directory = new Uint8Array(dirSectors * SECTOR)
  const dirView = new DataView(directory.buffer)
  const writeEntry = (
    index: number,
    name: string,
    kind: number,
    start: number,
    size: number,
    childId: number,
    rightId: number
  ): void => {
    const at = index * 128
    const encoded = utf16(name)
    directory.set(encoded, at)
    dirView.setUint16(at + 0x40, encoded.length + 2, true)
    dirView.setUint8(at + 0x42, kind)
    dirView.setUint32(at + 0x44, FREE, true) // left
    dirView.setUint32(at + 0x48, rightId, true)
    dirView.setUint32(at + 0x4c, childId, true)
    dirView.setUint32(at + 0x74, start, true)
    dirView.setUint32(at + 0x78, size, true)
  }
  // The root points at the first stream; the streams hang off one another to the right,
  // which is a legal if lopsided tree and exercises the walk.
  writeEntry(0, 'Root Entry', 5, miniStreamStart, miniStream.length, placed.length ? 1 : FREE, FREE)
  placed.forEach((stream, i) => {
    const isLast = i === placed.length - 1
    writeEntry(i + 1, stream.name, 2, stream.start, stream.data.length, FREE, isLast ? FREE : i + 2)
  })

  const out = new Uint8Array((totalSectors + 1) * SECTOR)
  const view = new DataView(out.buffer)
  out.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1], 0)
  view.setUint16(0x1e, 9, true)
  view.setUint16(0x20, 6, true)
  view.setUint32(0x2c, 1, true)
  view.setUint32(0x30, dirStart, true)
  view.setUint32(0x38, 4096, true)
  view.setUint32(0x3c, miniFatStart, true)
  view.setUint32(0x40, 1, true)
  view.setUint32(0x44, END_OF_CHAIN, true)
  view.setUint32(0x48, 0, true)
  for (let i = 0; i < 109; i++) view.setUint32(0x4c + i * 4, i === 0 ? 0 : FREE, true)

  const sectorAt = (id: number) => (id + 1) * SECTOR
  out.set(new Uint8Array(fat.buffer), sectorAt(0))
  out.set(directory, sectorAt(dirStart))
  out.set(new Uint8Array(miniFat.buffer), sectorAt(miniFatStart))
  out.set(miniStream, sectorAt(miniStreamStart))
  return out
}
