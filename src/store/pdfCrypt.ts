/**
 * Opening a PDF locked by the standard security handler — with the empty password.
 *
 * Most locked PDFs are not secret: a standard, a datasheet, a report sent "protected"
 * against being edited or printed has no password to open, only an owner's one to change
 * it, and every reader shows it. Its strings and streams are still enciphered, with a key
 * the empty password gives. That key is what this file finds, by the rules the PDF
 * specification sets out (algorithms 2, 2.A and 2.B), for each of the handler's
 * revisions: RC4 of 40 to 128 bits, AES of 128 and of 256.
 *
 * A file that does need a password to open is not opened: the empty one does not match,
 * and it says so.
 */

/** The 32 bytes a password is padded with, as the specification gives them. */
const PAD = Uint8Array.from([
  0x28, 0xbf, 0x4e, 0x5e, 0x4e, 0x75, 0x8a, 0x41, 0x64, 0x00, 0x4e, 0x56, 0xff, 0xfa, 0x01, 0x08, 0x2e, 0x2e, 0x00,
  0xb6, 0xd0, 0x68, 0x3e, 0x80, 0x2f, 0x0c, 0xa9, 0xfe, 0x64, 0x53, 0x69, 0x7a
])

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let at = 0
  for (const part of parts) {
    out.set(part, at)
    at += part.length
  }
  return out
}

function same(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((byte, at) => byte === b[at])
}

/* ---- MD5, which Web Crypto does not have ------------------------------------------ */

const SHIFTS = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21]
const SINES = Array.from({ length: 64 }, (_, at) => Math.floor(Math.abs(Math.sin(at + 1)) * 2 ** 32) >>> 0)

export function md5(data: Uint8Array): Uint8Array {
  const length = data.length
  const blocks = ((length + 8) >>> 6) + 1
  const words = new Uint32Array(blocks * 16)
  for (let at = 0; at < length; at++) words[at >>> 2] |= data[at] << ((at % 4) * 8)
  words[length >>> 2] |= 0x80 << ((length % 4) * 8)
  words[blocks * 16 - 2] = (length * 8) >>> 0
  words[blocks * 16 - 1] = Math.floor(length / 0x20000000)
  let a0 = 0x67452301
  let b0 = 0xefcdab89
  let c0 = 0x98badcfe
  let d0 = 0x10325476
  for (let block = 0; block < blocks; block++) {
    let [a, b, c, d] = [a0, b0, c0, d0]
    for (let step = 0; step < 64; step++) {
      const round = step >>> 4
      let f: number
      let g: number
      if (round === 0) {
        f = (b & c) | (~b & d)
        g = step
      } else if (round === 1) {
        f = (d & b) | (~d & c)
        g = (5 * step + 1) % 16
      } else if (round === 2) {
        f = b ^ c ^ d
        g = (3 * step + 5) % 16
      } else {
        f = c ^ (b | ~d)
        g = (7 * step) % 16
      }
      const sum = (a + f + SINES[step] + words[block * 16 + g]) >>> 0
      const shift = SHIFTS[round * 4 + (step % 4)]
      a = d
      d = c
      c = b
      b = (b + ((sum << shift) | (sum >>> (32 - shift)))) >>> 0
    }
    a0 = (a0 + a) >>> 0
    b0 = (b0 + b) >>> 0
    c0 = (c0 + c) >>> 0
    d0 = (d0 + d) >>> 0
  }
  const out = new Uint8Array(16)
  ;[a0, b0, c0, d0].forEach((word, at) => {
    for (let byte = 0; byte < 4; byte++) out[at * 4 + byte] = (word >>> (byte * 8)) & 0xff
  })
  return out
}

/* ---- RC4 ----------------------------------------------------------------------- */

export function rc4(key: Uint8Array, data: Uint8Array): Uint8Array {
  const state = new Uint8Array(256)
  for (let at = 0; at < 256; at++) state[at] = at
  for (let i = 0, j = 0; i < 256; i++) {
    j = (j + state[i] + key[i % key.length]) & 0xff
    ;[state[i], state[j]] = [state[j], state[i]]
  }
  const out = new Uint8Array(data.length)
  for (let at = 0, i = 0, j = 0; at < data.length; at++) {
    i = (i + 1) & 0xff
    j = (j + state[i]) & 0xff
    ;[state[i], state[j]] = [state[j], state[i]]
    out[at] = data[at] ^ state[(state[i] + state[j]) & 0xff]
  }
  return out
}

/* ---- AES, through Web Crypto ---------------------------------------------------- */

const buffer = (bytes: Uint8Array): Uint8Array<ArrayBuffer> => bytes as Uint8Array<ArrayBuffer>

async function aesKey(key: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', buffer(key), 'AES-CBC', false, ['encrypt', 'decrypt'])
}

/** CBC with no padding added: what Web Crypto adds at the end is cut off. */
async function aesEncrypt(key: Uint8Array, iv: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const out = await crypto.subtle.encrypt({ name: 'AES-CBC', iv: buffer(iv) }, await aesKey(key), buffer(data))
  return new Uint8Array(out, 0, data.length)
}

/**
 * CBC deciphered whatever its last block holds. Web Crypto insists on a well-padded end,
 * which a key's 32 bytes have not and a careless writer's stream may not: a block of
 * padding is enciphered after it, so the end is always good, and taken off again.
 */
async function aesDecrypt(key: Uint8Array, iv: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const whole = data.subarray(0, data.length - (data.length % 16))
  if (!whole.length) return new Uint8Array(0)
  const cryptoKey = await aesKey(key)
  const last = whole.subarray(whole.length - 16)
  const padding = new Uint8Array(16).fill(16)
  const extra = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-CBC', iv: buffer(last) }, cryptoKey, buffer(padding)),
    0,
    16
  )
  const out = await crypto.subtle.decrypt({ name: 'AES-CBC', iv: buffer(iv) }, cryptoKey, buffer(concat(whole, extra)))
  return new Uint8Array(out)
}

/** The padding a writer put at the end of what it enciphered, taken off where it is one. */
function unpad(data: Uint8Array): Uint8Array {
  const count = data[data.length - 1]
  if (!count || count > 16 || count > data.length) return data
  for (let at = data.length - count; at < data.length; at++) if (data[at] !== count) return data
  return data.subarray(0, data.length - count)
}

async function sha(bits: 256 | 384 | 512, data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest(`SHA-${bits}`, buffer(data)))
}

/* ---- The handler ---------------------------------------------------------------- */

/** How strings or streams are enciphered: not at all, RC4, or AES of 128 or 256 bits. */
type Method = 'none' | 'rc4' | 'aes128' | 'aes256'

/** What the encryption dictionary says, its strings as bytes. */
export interface EncryptSpec {
  filter: string
  v: number
  r: number
  /** In bits; 40 where not said. */
  length: number
  o: Uint8Array
  u: Uint8Array
  /** Revision 5 and 6: the file key, enciphered by the user's. */
  ue?: Uint8Array
  p: number
  encryptMetadata: boolean
  /** The crypt filters' methods, by name (V4 and V5), and which the strings and streams use. */
  filters: Map<string, { method: string; length?: number }>
  stmF: string
  strF: string
  /** The first of the file's identifiers. */
  id: Uint8Array
}

export class PdfLocked extends Error {}

/** Algorithm 2: the file key from a password, for revisions 2 to 4. */
function fileKey(spec: EncryptSpec, password: Uint8Array, bytes: number): Uint8Array {
  const padded = concat(password.subarray(0, 32), PAD.subarray(0, 32 - Math.min(32, password.length)))
  const p = spec.p >>> 0
  const parts = [
    padded,
    spec.o.subarray(0, 32),
    Uint8Array.of(p & 0xff, (p >>> 8) & 0xff, (p >>> 16) & 0xff, p >>> 24),
    spec.id
  ]
  if (spec.r >= 4 && !spec.encryptMetadata) parts.push(Uint8Array.of(0xff, 0xff, 0xff, 0xff))
  let key = md5(concat(...parts))
  if (spec.r >= 3) for (let round = 0; round < 50; round++) key = md5(key.subarray(0, bytes))
  return key.slice(0, bytes)
}

/** Algorithms 4 and 5: whether a key opens the file, by what it makes of the padding. */
function opens(spec: EncryptSpec, key: Uint8Array): boolean {
  if (spec.r === 2) return same(rc4(key, PAD), spec.u.subarray(0, 32))
  let out = rc4(key, md5(concat(PAD, spec.id)))
  for (let round = 1; round <= 19; round++) {
    const turned = key.map((byte) => byte ^ round)
    out = rc4(turned, out)
  }
  return same(out, spec.u.subarray(0, 16))
}

/** Algorithm 2.B — and revision 5's plain SHA-256 before it. */
async function hardHash(r: number, password: Uint8Array, salt: Uint8Array, user: Uint8Array): Promise<Uint8Array> {
  let key = await sha(256, concat(password, salt, user))
  if (r < 6) return key
  for (let round = 0; ; round++) {
    const once = concat(password, key, user)
    const repeated = new Uint8Array(once.length * 64)
    for (let at = 0; at < 64; at++) repeated.set(once, at * once.length)
    const enciphered = await aesEncrypt(key.subarray(0, 16), key.subarray(16, 32), repeated)
    // The first sixteen bytes as a number, modulo three: the same as their sum, modulo three.
    const choice = enciphered.subarray(0, 16).reduce((sum, byte) => sum + byte, 0) % 3
    key = await sha(choice === 0 ? 256 : choice === 1 ? 384 : 512, enciphered)
    // Sixty-four rounds at least, then until the last byte is no more than the rounds done less 32.
    const done = round + 1
    if (done >= 64 && enciphered[enciphered.length - 1] <= done - 32) break
  }
  return key.subarray(0, 32)
}

/** Algorithm 2.A: the file key for revisions 5 and 6, from the user's password. */
async function fileKey256(spec: EncryptSpec, password: Uint8Array): Promise<Uint8Array | null> {
  const u = spec.u
  if (u.length < 48 || !spec.ue || spec.ue.length < 32) return null
  const check = await hardHash(spec.r, password, u.subarray(32, 40), new Uint8Array(0))
  if (!same(check, u.subarray(0, 32))) return null
  const inter = await hardHash(spec.r, password, u.subarray(40, 48), new Uint8Array(0))
  return aesDecrypt(inter, new Uint8Array(16), spec.ue.subarray(0, 32))
}

function methodOf(spec: EncryptSpec, name: string): Method {
  if (spec.v < 4) return 'rc4'
  if (name === 'Identity') return 'none'
  const method = spec.filters.get(name)?.method ?? 'None'
  if (method === 'V2') return 'rc4'
  if (method === 'AESV2') return 'aes128'
  if (method === 'AESV3') return 'aes256'
  return 'none'
}

/**
 * What deciphers a locked file's strings and streams, each by the number and generation
 * of the object it is in — or, for AES of 256 bits, by the one key.
 */
export class PdfDecipher {
  private readonly keys = new Map<string, Uint8Array>()

  private constructor(
    private readonly key: Uint8Array,
    private readonly strings: Method,
    private readonly streams: Method
  ) {}

  /** Throws `PdfLocked` when the file needs a password to open, or is locked another way. */
  static async open(spec: EncryptSpec): Promise<PdfDecipher> {
    if (spec.filter !== 'Standard') throw new PdfLocked(`locked by the ${spec.filter} handler`)
    const strings = methodOf(spec, spec.strF)
    const streams = methodOf(spec, spec.stmF)
    if (spec.r >= 5) {
      const key = await fileKey256(spec, new Uint8Array(0))
      if (!key) throw new PdfLocked('a password is needed to open it')
      return new PdfDecipher(key, strings, streams)
    }
    if (spec.r < 2 || spec.r > 4) throw new PdfLocked(`revision ${spec.r} of the handler`)
    // The key's length: AES of 128 bits always has 16 bytes; else the dictionary says, in
    // bits — or in bytes, which some writers put in the crypt filter.
    const filterLength = spec.filters.get(spec.stmF)?.length
    const bits = filterLength ? (filterLength <= 32 ? filterLength * 8 : filterLength) : spec.length
    const bytes =
      spec.r === 2 ? 5 : streams === 'aes128' || strings === 'aes128' ? 16 : Math.min(16, Math.max(5, bits >> 3))
    const key = fileKey(spec, new Uint8Array(0), bytes)
    if (!opens(spec, key)) throw new PdfLocked('a password is needed to open it')
    return new PdfDecipher(key, strings, streams)
  }

  /** Algorithm 1: the key of one object's strings and streams. */
  private objectKey(num: number, gen: number, aes: boolean): Uint8Array {
    const name = `${num} ${gen} ${aes}`
    let key = this.keys.get(name)
    if (!key) {
      const salt = aes ? Uint8Array.of(0x73, 0x41, 0x6c, 0x54) : new Uint8Array(0)
      const seed = Uint8Array.of(num & 0xff, (num >>> 8) & 0xff, (num >>> 16) & 0xff, gen & 0xff, (gen >>> 8) & 0xff)
      key = md5(concat(this.key, seed, salt)).slice(0, Math.min(16, this.key.length + 5))
      this.keys.set(name, key)
    }
    return key
  }

  private async decipher(method: Method, num: number, gen: number, data: Uint8Array): Promise<Uint8Array> {
    if (method === 'none') return data
    if (method === 'rc4') return rc4(this.objectKey(num, gen, false), data)
    if (data.length < 16) return new Uint8Array(0)
    const key = method === 'aes256' ? this.key : this.objectKey(num, gen, true)
    return unpad(await aesDecrypt(key, data.subarray(0, 16), data.subarray(16)))
  }

  string(num: number, gen: number, data: Uint8Array): Promise<Uint8Array> {
    return this.decipher(this.strings, num, gen, data)
  }

  stream(num: number, gen: number, data: Uint8Array): Promise<Uint8Array> {
    return this.decipher(this.streams, num, gen, data)
  }
}
