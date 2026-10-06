import { md5, rc4 } from './pdfCrypt'

/**
 * Opening an Excel 97–2003 workbook enciphered with Excel's own password.
 *
 * A workbook protected against changes — not against reading — is enciphered all the same,
 * with the password Excel uses when none is given, « VelvetSweatshop », and opens without
 * asking. Its records' bytes are RC4-enciphered in blocks of 1024 bytes of the stream,
 * the key made again at each block from the password and the block's number — by MD5 (the
 * standard way of Office 97) or by SHA-1 (the CryptoAPI way of Office XP and 2003) —, the
 * records' headers and a few records left as they are.
 *
 * Any other password is one only its owner knows: such a workbook is not opened.
 */

const DEFAULT_PASSWORD = 'VelvetSweatshop'

/** Records whose bytes are never enciphered: the beginnings of substreams, the encryption's own, and locks. */
const PLAIN = new Set([0x0809, 0x002f, 0x0194, 0x0195, 0x00e1, 0x0196, 0x0138])
const BOUNDSHEET = 0x0085

function utf16le(text: string): Uint8Array {
  const out = new Uint8Array(text.length * 2)
  for (let at = 0; at < text.length; at++) {
    out[at * 2] = text.charCodeAt(at) & 0xff
    out[at * 2 + 1] = text.charCodeAt(at) >> 8
  }
  return out
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let at = 0
  for (const part of parts) {
    out.set(part, at)
    at += part.length
  }
  return out
}

const le32 = (value: number): Uint8Array =>
  Uint8Array.of(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff)

async function sha1(data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-1', data as Uint8Array<ArrayBuffer>))
}

const same = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((byte, at) => byte === b[at])

/** The key of each block of 1024 bytes, for one way of making them. */
type BlockKey = (block: number) => Promise<Uint8Array>

/** Office 97's way: MD5 of the password, five bytes of it with the salt sixteen times, then MD5 with the block. */
function standardKeys(salt: Uint8Array, password: string): BlockKey {
  const h0 = md5(utf16le(password)).subarray(0, 5)
  const repeated = new Uint8Array(21 * 16)
  for (let at = 0; at < 16; at++) repeated.set(concat(h0, salt), at * 21)
  const h1 = md5(repeated).subarray(0, 5)
  return (block) => Promise.resolve(md5(concat(h1, le32(block))))
}

/** CryptoAPI's way: SHA-1 of the salt and the password, then SHA-1 with the block, cut to the key's size. */
async function cryptoApiKeys(salt: Uint8Array, password: string, keyBits: number): Promise<BlockKey> {
  const h0 = await sha1(concat(salt, utf16le(password)))
  const bytes = keyBits ? keyBits / 8 : 5
  return async (block) => {
    const full = await sha1(concat(h0, le32(block)))
    // A key of 40 bits is used as sixteen bytes, the rest naught.
    if (bytes === 5) return concat(full.subarray(0, 5), new Uint8Array(11))
    return full.subarray(0, bytes)
  }
}

/**
 * The key-maker the encryption record describes, if the default password opens it; null
 * when it takes another password, or is a kind not read here (the XOR of Excel 95).
 */
async function keysFor(filepass: Uint8Array, password: string): Promise<BlockKey | null> {
  const view = new DataView(filepass.buffer, filepass.byteOffset, filepass.byteLength)
  if (filepass.length < 6 || view.getUint16(0, true) !== 1) return null
  const major = view.getUint16(2, true)
  const minor = view.getUint16(4, true)
  if (major === 1 && minor === 1 && filepass.length >= 54) {
    const salt = filepass.subarray(6, 22)
    const keys = standardKeys(salt, password)
    const opened = rc4(await keys(0), filepass.subarray(22, 54))
    return same(md5(opened.subarray(0, 16)), opened.subarray(16, 32)) ? keys : null
  }
  if (major >= 2 && minor === 2 && filepass.length >= 14) {
    const headerSize = view.getUint32(10, true)
    const header = 14
    const keyBits = header + 16 <= filepass.length ? view.getUint32(header + 16, true) : 0
    const verifier = header + headerSize
    if (verifier + 4 + 16 + 16 + 4 + 20 > filepass.length) return null
    const saltSize = view.getUint32(verifier, true)
    const salt = filepass.subarray(verifier + 4, verifier + 4 + saltSize)
    const encrypted = filepass.subarray(verifier + 4 + saltSize, verifier + 4 + saltSize + 16)
    const hashSize = view.getUint32(verifier + 4 + saltSize + 16, true)
    const hash = filepass.subarray(verifier + 8 + saltSize + 16, verifier + 8 + saltSize + 16 + hashSize)
    const keys = await cryptoApiKeys(salt, password, keyBits)
    const opened = rc4(await keys(0), concat(encrypted, hash))
    return same((await sha1(opened.subarray(0, 16))).subarray(0, hashSize), opened.subarray(16, 16 + hashSize))
      ? keys
      : null
  }
  return null
}

/**
 * The workbook stream deciphered, its records' bytes made plain; null when the password —
 * Excel's own unless another is given — does not open it.
 */
export async function decipherWorkbook(
  stream: Uint8Array,
  filepassAt: number,
  password = DEFAULT_PASSWORD
): Promise<Uint8Array | null> {
  const length = stream[filepassAt + 2] | (stream[filepassAt + 3] << 8)
  const keys = await keysFor(stream.subarray(filepassAt + 4, filepassAt + 4 + length), password)
  if (!keys) return null
  const out = stream.slice()
  const pads = new Map<number, Uint8Array>()
  const pad = async (block: number): Promise<Uint8Array> => {
    let found = pads.get(block)
    if (!found) {
      found = rc4(await keys(block), new Uint8Array(1024))
      pads.set(block, found)
    }
    return found
  }
  for (let at = filepassAt + 4 + length; at + 4 <= stream.length;) {
    const type = stream[at] | (stream[at + 1] << 8)
    const size = stream[at + 2] | (stream[at + 3] << 8)
    const start = at + 4
    if (!PLAIN.has(type)) {
      // A sheet's place in the stream is left plain, so it can be found before deciphering.
      for (let pos = type === BOUNDSHEET ? start + 4 : start; pos < start + size && pos < stream.length; pos++) {
        out[pos] = stream[pos] ^ (await pad(pos >> 10))[pos & 1023]
      }
    }
    at = start + size
  }
  return out
}
