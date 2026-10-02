import { fold } from './chatChange'

/**
 * Blanks in a ready question, filled in before it is sent.
 *
 * A question that is the same every week but for a date — "the report since …" — is
 * written once with the date left blank, and asked for at the click:
 *
 *     projet : Compte rendu :: Rédige le compte rendu depuis le {Depuis le:date}.
 *     Quelles sont les tâches de {Personne:personne} ?
 *     Traduis ces exigences en {Langue:langue}.
 *     Classe les risques par {Critère:coût|délai|qualité}.
 *
 * A blank is its label, then after a colon what it takes: a date, a person known to the
 * vault, a language of the library, one of a list, or text when nothing is said. A few
 * are filled without asking: today's date, the projects the question is about, and a
 * link to the note it is asked about.
 */

export type ParamKind = 'text' | 'date' | 'person' | 'language' | 'choice'

export interface PromptParam {
  /** What is between the braces, which is what is replaced. */
  raw: string
  label: string
  kind: ParamKind
  /** For a list of one's own: the entries. */
  choices: string[]
}

const KINDS: Record<string, ParamKind> = {
  date: 'date',
  texte: 'text',
  text: 'text',
  personne: 'person',
  person: 'person',
  langue: 'language',
  language: 'language'
}

/** The blanks filled without asking, by their folded name. */
export const AUTO_PARAMS: Record<string, 'today' | 'projects' | 'note' | 'files'> = {
  "aujourd'hui": 'today',
  'aujourd’hui': 'today',
  'date du jour': 'today',
  today: 'today',
  projet: 'projects',
  projets: 'projects',
  project: 'projects',
  projects: 'projects',
  note: 'note',
  'la note': 'note',
  fichiers: 'files',
  fichier: 'files',
  files: 'files',
  documents: 'files'
}

const BLANK = /\{([^{}\n]+)\}/g

/** The blanks a question asks for, each once, in the order they come. */
export function promptParams(question: string): PromptParam[] {
  const seen = new Set<string>()
  const out: PromptParam[] = []
  for (const found of question.matchAll(BLANK)) {
    const raw = found[1]
    const inside = raw.trim()
    if (!inside || seen.has(raw) || fold(inside) in AUTO_PARAMS) continue
    seen.add(raw)
    const colon = inside.indexOf(':')
    const label = (colon >= 0 ? inside.slice(0, colon) : inside.includes('|') ? '' : inside).trim()
    const spec = (colon >= 0 ? inside.slice(colon + 1) : inside.includes('|') ? inside : '').trim()
    const kind = KINDS[fold(spec)]
    if (kind) out.push({ raw, label, kind, choices: [] })
    else if (spec.includes('|')) {
      const choices = spec
        .split('|')
        .map((choice) => choice.trim())
        .filter(Boolean)
      out.push({ raw, label, kind: 'choice', choices })
    } else out.push({ raw, label: label || inside, kind: 'text', choices: [] })
  }
  return out
}

/**
 * The question with its blanks filled: the ones asked for from `values`, the others from
 * what is known. A blank with no value is left as it was, so nothing is sent half-said
 * without the reader seeing it.
 */
export function fillPrompt(
  question: string,
  values: Record<string, string>,
  known: { today: string; projects: string; note?: string; files?: string }
): string {
  return question.replace(BLANK, (whole, raw: string) => {
    const auto = AUTO_PARAMS[fold(raw.trim())]
    if (auto) return known[auto] || whole
    const value = values[raw]?.trim()
    return value || whole
  })
}
