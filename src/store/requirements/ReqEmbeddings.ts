import { normalizePath, TFile, type App } from 'obsidian'
import type { PMSettings } from '../../types'
import type { HttpTransport } from '../llm'
import { LlmClient } from '../llm'
import type { Requirement } from './Requirement'
import { textOf } from './Requirement'
import { normalizeForCompare, type EmbeddedItem } from './reqSimilar'

/**
 * Vectors for the library, asked for once and kept.
 *
 * Embedding is the only part of this that leaves the vault and the only part that costs
 * anything, so the answer is remembered — keyed on the text that produced it, which means
 * a requirement nobody has touched is never sent twice and a requirement that was
 * rewritten is sent again without anybody having to remember to say so.
 *
 * The cache is a file in the vault rather than a setting: a thousand vectors is megabytes
 * of numbers, and settings are read on every load of the plugin.
 */

export interface EmbeddingEntry {
  /** What the vector was made from, so a rewritten wording is noticed. */
  hash: string
  vector: number[]
}

export interface EmbeddingCache {
  /** Vectors from two models cannot be compared, so the model is part of the cache. */
  model: string
  entries: Record<string, EmbeddingEntry>
}

/**
 * FNV-1a, which is enough here.
 *
 * Nothing is defended by this — it only has to change when the text changes. A
 * cryptographic hash would be slower and would say the same thing.
 */
export function fnv1a(text: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

/**
 * What a requirement is embedded from: its source wording.
 *
 * One vector per requirement, not one per language. A multilingual model puts the French
 * and the English of one statement in the same place, so comparing every requirement's
 * source wording already finds a duplicate written in the other language — and a model
 * that is not multilingual would not be helped by embedding more of it.
 */
export function embeddingText(requirement: Requirement): string {
  const held = textOf(requirement, requirement.sourceLang)
  const body = held?.body ?? Object.values(requirement.text)[0]?.body ?? ''
  return normalizeForCompare(`${requirement.title} ${body}`)
}

/** Rounded before it is written: four decimals is far below what a cosine can tell apart. */
export function packVector(vector: number[]): number[] {
  return vector.map((value) => Math.round(value * 10000) / 10000)
}

export function readCache(raw: string): EmbeddingCache | null {
  try {
    const parsed = JSON.parse(raw) as Partial<EmbeddingCache>
    if (typeof parsed?.model !== 'string' || typeof parsed.entries !== 'object' || parsed.entries === null) return null
    return { model: parsed.model, entries: parsed.entries }
  } catch {
    return null
  }
}

/** Which requirements still need a vector, and which already have a good one. */
export function splitByCache(
  requirements: Requirement[],
  cache: EmbeddingCache | null,
  model: string
): { ready: EmbeddedItem[]; missing: Requirement[] } {
  const ready: EmbeddedItem[] = []
  const missing: Requirement[] = []
  // A cache made with another model is not a cache: its vectors live in a different
  // space, and comparing across the two produces numbers that mean nothing.
  const usable = cache && cache.model === model ? cache.entries : {}
  for (const requirement of requirements) {
    const text = embeddingText(requirement)
    if (!text) continue
    const held = usable[requirement.id]
    if (held && held.hash === fnv1a(text)) ready.push({ id: requirement.id, vector: held.vector })
    else missing.push(requirement)
  }
  return { ready, missing }
}

export interface EmbedProgress {
  done: number
  total: number
}

/** How many texts go in one request. Small enough to survive a gateway's own limits. */
const BATCH = 32

export class ReqEmbeddingIndex {
  constructor(
    private app: App,
    private getSettings: () => PMSettings,
    private transport?: HttpTransport
  ) {}

  get available(): boolean {
    const llm = this.getSettings().llm
    return llm.enabled && llm.baseUrl.trim() !== '' && llm.modelEmbed.trim() !== ''
  }

  private cachePath(): string {
    const folder = this.getSettings().requirements.folder
    return normalizePath(folder ? `${folder}/_embeddings.json` : '_embeddings.json')
  }

  async loadCache(): Promise<EmbeddingCache | null> {
    const file = this.app.vault.getAbstractFileByPath(this.cachePath())
    if (!(file instanceof TFile)) return null
    return readCache(await this.app.vault.cachedRead(file))
  }

  private async saveCache(cache: EmbeddingCache): Promise<void> {
    const path = this.cachePath()
    const folder = path.slice(0, path.lastIndexOf('/'))
    if (folder && !this.app.vault.getAbstractFileByPath(folder)) {
      await this.app.vault.createFolder(folder).catch(() => {})
    }
    const contents = JSON.stringify(cache)
    const file = this.app.vault.getAbstractFileByPath(path)
    if (file instanceof TFile) await this.app.vault.modify(file, contents)
    else await this.app.vault.create(path, contents)
  }

  /**
   * A vector for every requirement, asking only for the ones that need one.
   *
   * In batches and in order, so a library of a thousand does not arrive at the gateway as
   * one request it will refuse, and so the run can be stopped: a reader who set this going
   * by mistake should not have to wait for it to finish.
   */
  async embedAll(
    requirements: Requirement[],
    onProgress?: (progress: EmbedProgress) => void,
    shouldStop?: () => boolean
  ): Promise<EmbeddedItem[]> {
    const model = this.getSettings().llm.modelEmbed
    const cache = await this.loadCache()
    const { ready, missing } = splitByCache(requirements, cache, model)
    if (!missing.length) return ready

    const client = new LlmClient({
      settings: this.getSettings().llm,
      ...(this.transport ? { transport: this.transport } : {})
    })
    const entries: Record<string, EmbeddingEntry> = cache?.model === model ? { ...cache.entries } : {}
    const fresh: EmbeddedItem[] = []

    for (let at = 0; at < missing.length; at += BATCH) {
      if (shouldStop?.()) break
      onProgress?.({ done: at, total: missing.length })
      const batch = missing.slice(at, at + BATCH)
      const vectors = await client.embed(batch.map((requirement) => embeddingText(requirement)))
      batch.forEach((requirement, index) => {
        const vector = vectors[index]
        if (!vector) return
        const packed = packVector(vector)
        entries[requirement.id] = { hash: fnv1a(embeddingText(requirement)), vector: packed }
        fresh.push({ id: requirement.id, vector: packed })
      })
    }
    onProgress?.({ done: missing.length, total: missing.length })
    // Written even when the run was stopped halfway: what was paid for is kept.
    await this.saveCache({ model, entries })
    return [...ready, ...fresh]
  }
}
