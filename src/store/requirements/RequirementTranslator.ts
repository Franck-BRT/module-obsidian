import type { PMSettings } from '../../types'
import type { HttpTransport } from '../llm'
import { LlmClient, LlmError } from '../llm'
import type { Requirement } from './Requirement'
import { setText, textOf } from './Requirement'
import type { RequirementStore } from './RequirementStore'
import { buildTranslationRequest, hasDrifted, quantityDrift, readTranslation, type QuantityDrift } from './translate'

/**
 * Translating requirements with the gateway.
 *
 * Every wording it writes is marked as a machine's and unreviewed, and stays that way
 * until a person says otherwise: the point of the library is that somebody is accountable
 * for each statement, and a translation nobody has read is a draft, however good it
 * reads. The tool's job is to make the draft and to be loud about what it might have got
 * wrong, not to close the loop on its own.
 */

export interface TranslationOutcome {
  id: string
  path: string
  lang: string
  ok: boolean
  /** Figures that moved between the source and the translation. Empty on a clean one. */
  drift?: QuantityDrift
  /** What the model said it could not resolve. */
  notes?: string
  error?: string
  /** Why the run stopped here, when it did. */
  fatal?: boolean
}

export interface BulkProgress {
  done: number
  total: number
  current: string
}

/** A failure that says nothing about this requirement and everything about the network. */
function isFatal(error: unknown): boolean {
  return (
    error instanceof LlmError && (error.kind === 'unreachable' || error.kind === 'timeout' || error.kind === 'disabled')
  )
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export class RequirementTranslator {
  constructor(
    private getSettings: () => PMSettings,
    private store: RequirementStore,
    /** Injected in tests. In the app the client builds its own, over Obsidian's HTTP. */
    private transport?: HttpTransport
  ) {}

  /** Whether there is anywhere to ask. A model for translation is part of being configured. */
  get available(): boolean {
    const llm = this.getSettings().llm
    return llm.enabled && llm.baseUrl.trim() !== '' && llm.modelTranslate.trim() !== ''
  }

  private client(): LlmClient {
    return new LlmClient({
      settings: this.getSettings().llm,
      ...(this.transport ? { transport: this.transport } : {})
    })
  }

  private author(): string {
    return this.getSettings().globalTeamMembers[0] ?? ''
  }

  /**
   * One requirement, into one language.
   *
   * The source is whatever the requirement says its source language is, never the wording
   * that happens to be on screen: translating a translation is how a library ends up with
   * three statements that no longer agree.
   */
  async translate(requirement: Requirement, lang: string): Promise<TranslationOutcome> {
    const path = requirement.filePath ?? ''
    const base = { id: requirement.id, path, lang }
    const source = textOf(requirement, requirement.sourceLang)
    if (!source || !path) {
      return { ...base, ok: false, error: 'no-source' }
    }
    if (lang === requirement.sourceLang) {
      return { ...base, ok: false, error: 'same-language' }
    }

    try {
      const reply = readTranslation(
        await this.client().chatJson(
          buildTranslationRequest(
            this.getSettings().llm.modelTranslate,
            source.body,
            requirement.sourceLang,
            lang,
            requirement.title ? { title: requirement.title } : {},
            this.getSettings().requirements.translatePrompt
          )
        )
      )
      // Written before the drift is reported, not after: the reader needs the draft in
      // front of them to judge the warning, and a translation withheld because it might
      // be wrong is a translation nobody can check.
      await this.store.update(path, (current) => setText(current, lang, reply.text, this.author() || 'llm', 'machine'))
      const drift = quantityDrift(source.body, reply.text)
      return {
        ...base,
        ok: true,
        ...(hasDrifted(drift) ? { drift } : {}),
        ...(reply.notes ? { notes: reply.notes } : {})
      }
    } catch (error) {
      return { ...base, ok: false, error: messageOf(error), ...(isFatal(error) ? { fatal: true } : {}) }
    }
  }

  /**
   * A whole shelf of them, one after another.
   *
   * Sequential on purpose. The gateway sits behind somebody's network and a library of a
   * few hundred requirements fired at it at once is a denial of service written by
   * accident; it also makes the run impossible to stop halfway, which is the first thing
   * a reader wants when the first three come back wrong.
   *
   * The run gives up on a failure that is about the network rather than about the text,
   * and after three failures in a row of any kind: the fourth is not going to be the one
   * that works, and every attempt costs the reader time they did not agree to spend.
   */
  async translateMany(
    jobs: { requirement: Requirement; lang: string }[],
    onProgress?: (progress: BulkProgress) => void,
    shouldStop?: () => boolean
  ): Promise<TranslationOutcome[]> {
    const outcomes: TranslationOutcome[] = []
    let consecutiveFailures = 0
    for (const [index, job] of jobs.entries()) {
      if (shouldStop?.()) break
      onProgress?.({ done: index, total: jobs.length, current: job.requirement.id })
      const outcome = await this.translate(job.requirement, job.lang)
      outcomes.push(outcome)
      if (outcome.ok) {
        consecutiveFailures = 0
        continue
      }
      consecutiveFailures += 1
      if (outcome.fatal || consecutiveFailures >= 3) break
    }
    onProgress?.({ done: outcomes.length, total: jobs.length, current: '' })
    return outcomes
  }
}
