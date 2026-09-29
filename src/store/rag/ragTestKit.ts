import { fold } from '../library/libraryDoc'
import type { Embedder, RagSourceSpec, RagStorage } from './RagIndex'

/** Test helpers: an index kept in memory, and an embedding model made of words. */

export class MemoryStorage implements RagStorage {
  files = new Map<string, string | ArrayBuffer>()
  writes = 0
  async read(name: string): Promise<string | null> {
    const found = this.files.get(name)
    return typeof found === 'string' ? found : null
  }
  async readBinary(name: string): Promise<ArrayBuffer | null> {
    const found = this.files.get(name)
    return found instanceof ArrayBuffer ? found : null
  }
  async write(name: string, data: string): Promise<void> {
    this.writes++
    this.files.set(name, data)
  }
  async writeBinary(name: string, data: ArrayBuffer): Promise<void> {
    this.files.set(name, data.slice(0))
  }
}

/**
 * An embedding model for tests: each word, folded and without its plural, lands on a few
 * of 64 dimensions, and words that mean the same — a list of synonyms — land together,
 * which is what a real model does and a search by words cannot.
 */
export function wordEmbedder(synonyms: string[][] = [], calls: string[][] = []): Embedder {
  const canon = new Map<string, string>()
  for (const group of synonyms) for (const word of group) canon.set(word, group[0])
  return async (texts) => {
    calls.push(texts)
    return texts.map((text) => {
      const vector = new Array<number>(64).fill(0)
      for (let word of fold(text).split(/[^\p{L}\p{N}]+/u)) {
        if (word.length < 3) continue
        if (word.length > 4 && word.endsWith('s')) word = word.slice(0, -1)
        word = canon.get(word) ?? word
        let hash = 7
        for (const char of word) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
        vector[hash % 64] += 1
        vector[(hash >>> 8) % 64] += 0.5
      }
      return vector
    })
  }
}

export const source = (path: string, text: string, over: Partial<RagSourceSpec> = {}): RagSourceSpec => ({
  path,
  title: path.replace(/^.*\//, '').replace(/\.\w+$/, ''),
  kind: 'note',
  key: String(text.length),
  projects: [],
  read: async () => text,
  ...over
})
