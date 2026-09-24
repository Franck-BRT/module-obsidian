import { crc32 } from './zip'

/**
 * Reading a ZIP archive, by hand.
 *
 * For `.reqifz`, which is how DOORS and most requirements tools hand a ReqIF over: the
 * XML and its attachments, compressed. The writer next door never compresses; a reader
 * has to take what it is given, so deflate is unpacked by the platform's own
 * `DecompressionStream` — present in Obsidian and in Node alike — rather than by a
 * dependency.
 *
 * Every entry is checked against the CRC the archive wrote for it. A file that unpacks
 * to the wrong bytes is refused, because an import read from corrupt bytes is an import
 * of requirements nobody wrote.
 */

export class ZipError extends Error {}

export interface UnzippedEntry {
  name: string
  data: Uint8Array
}

const END_OF_DIRECTORY = 0x06054b50
const DIRECTORY_ENTRY = 0x02014b50
const LOCAL_HEADER = 0x04034b50

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

function findEnd(view: DataView): number {
  // The end record sits at the end, followed by a comment of up to 64 KiB.
  const lowest = Math.max(0, view.byteLength - 22 - 0xffff)
  for (let at = view.byteLength - 22; at >= lowest; at--) {
    if (view.getUint32(at, true) === END_OF_DIRECTORY) return at
  }
  throw new ZipError('not a ZIP archive')
}

/**
 * The entries whose names pass `wanted`, unpacked and checked.
 *
 * Filtered before unpacking, so a ReqIF carrying a hundred megabytes of attached images
 * does not unpack every one of them to read the one XML file that matters.
 */
export async function unzip(
  bytes: Uint8Array,
  wanted: (name: string) => boolean = () => true
): Promise<UnzippedEntry[]> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const end = findEnd(view)
  const count = view.getUint16(end + 10, true)
  let at = view.getUint32(end + 16, true)
  const decoder = new TextDecoder()
  const out: UnzippedEntry[] = []

  for (let index = 0; index < count; index++) {
    if (at + 46 > bytes.length || view.getUint32(at, true) !== DIRECTORY_ENTRY) {
      throw new ZipError('damaged central directory')
    }
    const method = view.getUint16(at + 10, true)
    const crc = view.getUint32(at + 16, true)
    const packedSize = view.getUint32(at + 20, true)
    const size = view.getUint32(at + 24, true)
    const nameLength = view.getUint16(at + 28, true)
    const extraLength = view.getUint16(at + 30, true)
    const commentLength = view.getUint16(at + 32, true)
    const local = view.getUint32(at + 42, true)
    const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength))
    at += 46 + nameLength + extraLength + commentLength

    if (name.endsWith('/') || !wanted(name)) continue
    if (local + 30 > bytes.length || view.getUint32(local, true) !== LOCAL_HEADER) {
      throw new ZipError(`${name}: damaged entry`)
    }
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true)
    const packed = bytes.subarray(start, start + packedSize)
    if (packed.length !== packedSize) throw new ZipError(`${name}: truncated`)

    let data: Uint8Array
    if (method === 0) data = packed
    else if (method === 8) data = await inflate(packed)
    else throw new ZipError(`${name}: compression method ${method} is not supported`)
    if (data.length !== size || crc32(data) !== crc) throw new ZipError(`${name}: damaged (checksum)`)
    out.push({ name, data })
  }
  return out
}
