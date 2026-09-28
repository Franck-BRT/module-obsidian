/**
 * Questions ready to ask: the ones every project review starts with, one click away.
 *
 * Each belongs to what it is about — the open note, the attached project, the attached
 * requirements — and is offered only when that is there to be asked about: "where does
 * this project stand?" with no project attached is a question the model can only answer
 * by making something up.
 *
 * The reader's own come from a plain list in the settings, one per line, so a house's
 * weekly review question is written once in its own words:
 *
 *     projet : Point hebdo :: Fais le point de la semaine pour le comité…
 *     Traduis ta dernière réponse en anglais.
 *
 * A line may start with what it is about (`projet :`, `exigences :`, `note :`, in French
 * or English) and may give itself a short name before `::`. A line with neither is a
 * question for any conversation, named by itself.
 */

export type PromptScope = 'any' | 'note' | 'project' | 'requirements'

export interface ChatPrompt {
  /** What the button says. */
  label: string
  /** What is sent. */
  question: string
  scope: PromptScope
  /** One of the reader's, from the settings, rather than one the plugin ships. */
  own: boolean
}

const SCOPE_WORDS: Record<string, PromptScope> = {
  projet: 'project',
  project: 'project',
  exigence: 'requirements',
  exigences: 'requirements',
  requirement: 'requirements',
  requirements: 'requirements',
  note: 'note',
  tout: 'any',
  toujours: 'any',
  any: 'any',
  always: 'any'
}

/** The reader's list, read. A line that says nothing once its prefixes are taken off is skipped. */
export function parsePrompts(text: string): ChatPrompt[] {
  const prompts: ChatPrompt[] = []
  for (const raw of text.split(/\r?\n/)) {
    let line = raw.trim()
    if (!line || line.startsWith('#')) continue
    let scope: PromptScope = 'any'
    const prefix = /^([\p{L}]+)\s*:(?!:)\s*/u.exec(line)
    const word = prefix ? SCOPE_WORDS[prefix[1].toLowerCase()] : undefined
    if (prefix && word) {
      scope = word
      line = line.slice(prefix[0].length)
    }
    const named = line.indexOf('::')
    const label = named >= 0 ? line.slice(0, named).trim() : ''
    const question = (named >= 0 ? line.slice(named + 2) : line).trim()
    if (!question) continue
    prompts.push({ label: label || question, question, scope, own: true })
  }
  return prompts
}

/** What is attached to the next question, which decides what is offered. */
export interface PromptContext {
  note: boolean
  project: boolean
  requirements: boolean
}

/** The order the groups are offered in: the most particular first. */
export const SCOPE_ORDER: PromptScope[] = ['project', 'requirements', 'note', 'any']

/**
 * The questions that make sense now, the reader's before the plugin's within each group,
 * and a question offered twice — the reader copied a shipped one to keep it — only once.
 */
export function availablePrompts(prompts: ChatPrompt[], context: PromptContext): ChatPrompt[] {
  const fits = (scope: PromptScope): boolean => scope === 'any' || context[scope]
  const seen = new Set<string>()
  const out: ChatPrompt[] = []
  for (const scope of SCOPE_ORDER) {
    if (!fits(scope)) continue
    const group = prompts.filter((prompt) => prompt.scope === scope)
    for (const prompt of [...group.filter((one) => one.own), ...group.filter((one) => !one.own)]) {
      const key = prompt.question.replace(/\s+/g, ' ').trim().toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      out.push(prompt)
    }
  }
  return out
}
