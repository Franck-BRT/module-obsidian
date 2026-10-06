/**
 * The compound file of Microsoft's older formats — Word 97–2003, and Outlook's messages,
 * Excel's and PowerPoint's of the same age —: a small file system inside one file, its
 * streams cut into sectors chained by a table, as a disk is.
 *
 * Read here: the header, the chains of the sector table, the directory, and the short
 * streams kept in the mini stream. Each stream comes back whole, by its name.
 */

export class CfbError extends Error {}

const MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]
const END_OF_CHAIN = 0xfffffffe
const FREE = 0xffffffff

export function isCfb(bytes: Uint8Array): boolean {
  return bytes.length >= 512 && MAGIC.every((byte, at) => bytes[at] === byte)
}

export interface CfbEntry {
  name: string
  /** 1 a storage, 2 a stream, 5 the root. */
  type: number
  start: number
  size: number
  /** The tree the directory is: siblings to each side, and a storage's first child. */
  left: number
  right: number
  child: number
}

export interface CfbFile {
  entries: CfbEntry[]
  /** The entries of the storage a path of names leads to — the root's when there is none. */
  children(path?: string[]): CfbEntry[]
  /**
   * A stream's bytes by its name, among the storage's own — the root's by default, not
   * those of an object embedded below, which may bear the same name; null when there is none.
   */
  stream(name: string, path?: string[]): Uint8Array | null
}

export function readCfb(bytes: Uint8Array): CfbFile {
  if (!isCfb(bytes)) throw new CfbError('not a compound file')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const u16 = (at: number): number => view.getUint16(at, true)
  const u32 = (at: number): number => view.getUint32(at, true)
  const sectorSize = 1 << u16(30)
  const miniSize = 1 << u16(32)
  if (sectorSize !== 512 && sectorSize !== 4096) throw new CfbError('unknown sector size')
  const fatSectors = u32(44)
  const firstDir = u32(48)
  const cutoff = u32(56)
  const firstMiniFat = u32(60)
  let difatNext = u32(68)
  const sectorAt = (sector: number): number => (sector + 1) * sectorSize
  const sectorCount = Math.floor((bytes.length - sectorSize) / sectorSize) + 1

  // Where the sector table's own sectors are: 109 in the header, the rest in a chain.
  const fatList: number[] = []
  for (let at = 0; at < 109 && fatList.length < fatSectors; at++) {
    const sector = u32(76 + at * 4)
    if (sector !== FREE) fatList.push(sector)
  }
  for (let guard = 0; difatNext !== END_OF_CHAIN && difatNext !== FREE && guard < sectorCount; guard++) {
    const base = sectorAt(difatNext)
    if (base + sectorSize > bytes.length) break
    for (let at = 0; at < sectorSize / 4 - 1 && fatList.length < fatSectors; at++) {
      const sector = u32(base + at * 4)
      if (sector !== FREE) fatList.push(sector)
    }
    difatNext = u32(base + sectorSize - 4)
  }
  const fat: number[] = []
  for (const sector of fatList) {
    const base = sectorAt(sector)
    for (let at = 0; at < sectorSize / 4 && base + at * 4 + 4 <= bytes.length; at++) fat.push(u32(base + at * 4))
  }

  /** A chain's bytes, as long as the chain is — a loop or a broken link ends it. */
  const chain = (start: number, table: number[], read: (sector: number) => Uint8Array): Uint8Array => {
    const parts: Uint8Array[] = []
    const seen = new Set<number>()
    for (let sector = start; sector !== END_OF_CHAIN && sector < table.length && !seen.has(sector);) {
      seen.add(sector)
      parts.push(read(sector))
      sector = table[sector]
    }
    const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
    let at = 0
    for (const part of parts) {
      out.set(part, at)
      at += part.length
    }
    return out
  }
  const big = (sector: number): Uint8Array => bytes.subarray(sectorAt(sector), sectorAt(sector) + sectorSize)

  const dir = chain(firstDir, fat, big)
  const entries: CfbEntry[] = []
  const dirView = new DataView(dir.buffer, dir.byteOffset, dir.byteLength)
  for (let at = 0; at + 128 <= dir.length; at += 128) {
    const nameLength = Math.min(64, dirView.getUint16(at + 64, true))
    let name = ''
    for (let char = 0; char + 2 < nameLength; char += 2) name += String.fromCharCode(dirView.getUint16(at + char, true))
    entries.push({
      name,
      type: dir[at + 66],
      left: dirView.getUint32(at + 68, true),
      right: dirView.getUint32(at + 72, true),
      child: dirView.getUint32(at + 76, true),
      start: dirView.getUint32(at + 116, true),
      // The high half of the size is only meant for 4096-byte sectors; elsewhere it may be noise.
      size: dirView.getUint32(at + 120, true)
    })
  }
  const root = entries.find((entry) => entry.type === 5)
  const miniStream = root ? chain(root.start, fat, big) : new Uint8Array(0)
  const miniFatBytes = firstMiniFat === END_OF_CHAIN ? new Uint8Array(0) : chain(firstMiniFat, fat, big)
  const miniFat: number[] = []
  for (let at = 0; at + 4 <= miniFatBytes.length; at += 4) {
    miniFat.push(
      miniFatBytes[at] | (miniFatBytes[at + 1] << 8) | (miniFatBytes[at + 2] << 16) | (miniFatBytes[at + 3] * 0x1000000)
    )
  }
  const mini = (sector: number): Uint8Array => miniStream.subarray(sector * miniSize, (sector + 1) * miniSize)

  /** A storage's own entries: its child, and that child's siblings, as a tree. */
  const childrenOf = (parent: CfbEntry | undefined): CfbEntry[] => {
    const found = new Set<CfbEntry>()
    const walk = (id: number, depth: number): void => {
      const entry = entries[id]
      if (!entry || found.has(entry) || depth > entries.length) return
      found.add(entry)
      walk(entry.left, depth + 1)
      walk(entry.right, depth + 1)
    }
    if (parent) walk(parent.child, 0)
    return [...found]
  }
  /** The entry a path of names leads to from the root, storage by storage. */
  const at = (path: string[]): CfbEntry | undefined => {
    let entry = root
    for (const name of path) entry = childrenOf(entry).find((one) => one.name === name)
    return entry
  }

  return {
    entries,
    children(path = []) {
      const storage = at(path)
      return storage && storage.type !== 2 ? childrenOf(storage) : []
    },
    stream(name, path = []) {
      const storage = at(path)
      const entry = storage && childrenOf(storage).find((one) => one.type === 2 && one.name === name)
      if (!entry) return null
      const data = entry.size < cutoff ? chain(entry.start, miniFat, mini) : chain(entry.start, fat, big)
      return data.subarray(0, Math.min(entry.size, data.length))
    }
  }
}
