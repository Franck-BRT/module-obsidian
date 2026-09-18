/**
 * Just enough of the Compound File Binary format to read a `.msg`.
 *
 * An Outlook message is not a mail file at all: it is a tiny filesystem — the same
 * container an old .doc used — holding one stream per property. Reading it means reading
 * that filesystem, which is why this exists rather than a call to a mail parser.
 *
 * Only what is needed to find and read a named stream is implemented: the sector
 * allocation table, the mini table small streams live in, and the directory. Writing,
 * and everything about the red-black tree beyond walking it, is out of scope.
 */

const SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]
const END_OF_CHAIN = 0xfffffffe
const FREE_SECTOR = 0xffffffff
const NO_ENTRY = 0xffffffff
/** A chain longer than this means a corrupt or hostile file, not a big message. */
const MAX_CHAIN = 1_000_000

export interface CfbEntry {
  name: string
  /** 1 storage (a folder), 2 stream (a file), 5 the root. */
  kind: number
  size: number
  start: number
  childId: number
  leftId: number
  rightId: number
}

export interface CfbFile {
  /** The direct children of the root, by name. A `.msg` keeps its properties here. */
  entries: Map<string, CfbEntry>
  /**
   * The children of a storage, by name.
   *
   * A message's attachments are not streams at the root: each is a storage of its own,
   * holding the attachment's name and its bytes as separate streams inside. Reading one
   * means stepping into it, which is why the walk is not confined to the root.
   */
  childrenOf(entry: CfbEntry): Map<string, CfbEntry>
  read(entry: CfbEntry): Uint8Array
}

export function looksLikeCfb(bytes: Uint8Array): boolean {
  return bytes.length >= 512 && SIGNATURE.every((byte, i) => bytes[i] === byte)
}

export function readCfb(bytes: Uint8Array): CfbFile {
  if (!looksLikeCfb(bytes)) throw new Error('Not a compound file')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const u32 = (at: number): number => view.getUint32(at, true)

  const sectorSize = 1 << view.getUint16(0x1e, true)
  const miniSectorSize = 1 << view.getUint16(0x20, true)
  const miniCutoff = u32(0x38)
  // Sector 0 begins after the header, which occupies the whole of the first sector.
  const sectorAt = (id: number): number => (id + 1) * sectorSize

  // The FAT lives in the sectors the DIFAT lists: 109 of them in the header, the rest in
  // DIFAT sectors chained through their own last entry.
  const fatSectors: number[] = []
  for (let i = 0; i < 109; i++) {
    const id = u32(0x4c + i * 4)
    if (id === FREE_SECTOR) break
    fatSectors.push(id)
  }
  let difat = u32(0x44)
  for (let guard = 0; difat !== END_OF_CHAIN && difat !== FREE_SECTOR && guard < MAX_CHAIN; guard++) {
    const base = sectorAt(difat)
    const perSector = sectorSize / 4 - 1
    for (let i = 0; i < perSector; i++) {
      const id = u32(base + i * 4)
      if (id === FREE_SECTOR) break
      fatSectors.push(id)
    }
    difat = u32(base + perSector * 4)
  }

  const fat: number[] = []
  for (const sector of fatSectors) {
    const base = sectorAt(sector)
    for (let i = 0; i < sectorSize / 4; i++) fat.push(u32(base + i * 4))
  }

  const chain = (start: number, table: number[]): number[] => {
    const out: number[] = []
    let id = start
    while (id !== END_OF_CHAIN && id !== FREE_SECTOR && id < table.length && out.length < MAX_CHAIN) {
      out.push(id)
      id = table[id]
    }
    return out
  }

  const readChain = (start: number, size: number, table: number[], unit: number, base: (id: number) => number) => {
    const out = new Uint8Array(size)
    let written = 0
    for (const id of chain(start, table)) {
      if (written >= size) break
      const from = base(id)
      const take = Math.min(unit, size - written, bytes.length - from)
      if (take <= 0) break
      out.set(bytes.subarray(from, from + take), written)
      written += take
    }
    return out
  }

  // The directory is itself a stream in the FAT, 128 bytes to an entry.
  const dirBytes = readChain(u32(0x30), chain(u32(0x30), fat).length * sectorSize, fat, sectorSize, sectorAt)
  const entries: CfbEntry[] = []
  for (let at = 0; at + 128 <= dirBytes.length; at += 128) {
    const nameLength = new DataView(dirBytes.buffer, dirBytes.byteOffset + at, 128).getUint16(0x40, true)
    const nameBytes = dirBytes.subarray(at, at + Math.max(0, nameLength - 2))
    const dv = new DataView(dirBytes.buffer, dirBytes.byteOffset + at, 128)
    entries.push({
      name: new TextDecoder('utf-16le').decode(nameBytes),
      kind: dv.getUint8(0x42),
      leftId: dv.getUint32(0x44, true),
      rightId: dv.getUint32(0x48, true),
      childId: dv.getUint32(0x4c, true),
      start: dv.getUint32(0x74, true),
      size: dv.getUint32(0x78, true)
    })
  }

  const root = entries[0]
  if (!root) throw new Error('Compound file has no root')

  // Small streams are packed into one big stream hanging off the root, cut into mini
  // sectors and chained by a table of their own.
  const miniFat: number[] = []
  {
    const base = readChain(u32(0x3c), chain(u32(0x3c), fat).length * sectorSize, fat, sectorSize, sectorAt)
    const dv = new DataView(base.buffer, base.byteOffset, base.byteLength)
    for (let i = 0; i + 4 <= base.length; i += 4) miniFat.push(dv.getUint32(i, true))
  }
  const miniStream = readChain(root.start, root.size, fat, sectorSize, sectorAt)

  const read = (entry: CfbEntry): Uint8Array => {
    if (entry.size < miniCutoff) {
      const out = new Uint8Array(entry.size)
      let written = 0
      for (const id of chain(entry.start, miniFat)) {
        if (written >= entry.size) break
        const from = id * miniSectorSize
        const take = Math.min(miniSectorSize, entry.size - written, miniStream.length - from)
        if (take <= 0) break
        out.set(miniStream.subarray(from, from + take), written)
        written += take
      }
      return out
    }
    return readChain(entry.start, entry.size, fat, sectorSize, sectorAt)
  }

  // The children of a storage are a red-black tree; the order does not matter here, only
  // that every one of them is seen exactly once.
  const walk = (childId: number): Map<string, CfbEntry> => {
    const children = new Map<string, CfbEntry>()
    const visit = (id: number, seen: Set<number>): void => {
      if (id === NO_ENTRY || id >= entries.length || seen.has(id)) return
      seen.add(id)
      const entry = entries[id]
      children.set(entry.name, entry)
      visit(entry.leftId, seen)
      visit(entry.rightId, seen)
    }
    visit(childId, new Set())
    return children
  }

  return { entries: walk(root.childId), childrenOf: (entry) => walk(entry.childId), read }
}
