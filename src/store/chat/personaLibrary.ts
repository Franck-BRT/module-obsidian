import { stringifyYaml } from 'obsidian'
import { fold } from '../library/libraryDoc'
import { skillBody } from './skills'
import { promptFileName } from './promptLibrary'

/**
 * The persona library: roles the chat is given to answer in — a site manager, a public
 * procurement lawyer, an inspector —, written once, kept, chosen for a conversation.
 *
 * A persona is a note found by its `pm-persona` property wherever it is: its name is the
 * note's, its body who the chat is to be and how it is to answer — its trade, what it
 * knows, its tone, what it checks first —, and a few properties file it and say what it is
 * for. One persona at a time speaks in a conversation; unlike a skill, which adds a way of
 * doing one thing, a persona is who answers.
 */

export const PERSONA_KEY = 'pm-persona'

export interface PersonaNote {
  path: string
  name: string
  /** Who the chat is to be, and how it answers. */
  instructions: string
  category: string
  description: string
  favorite: boolean
}

export function isPersonaNote(frontmatter: unknown): boolean {
  return (
    !!frontmatter && typeof frontmatter === 'object' && (frontmatter as Record<string, unknown>)[PERSONA_KEY] === true
  )
}

function text(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim() : typeof raw === 'number' ? String(raw) : ''
}

/** A persona from its note — properties and content; null when the note is not one, or says nothing. */
export function readPersonaNote(
  path: string,
  basename: string,
  frontmatter: unknown,
  content: string
): PersonaNote | null {
  if (!isPersonaNote(frontmatter)) return null
  const fm = frontmatter as Record<string, unknown>
  const instructions = skillBody(content)
    .replace(/%%[\s\S]*?%%/g, '')
    .trim()
  if (!instructions) return null
  return {
    path,
    name: text(fm.name ?? fm.nom) || basename,
    instructions,
    category: text(fm.category ?? fm.categorie ?? fm['catégorie']),
    description: text(fm.description),
    favorite: fm.favorite === true || fm.favori === true
  }
}

export interface PersonaDraft {
  category: string
  description: string
  favorite: boolean
  instructions: string
}

/** A persona's note: its properties, then who it is. */
export function personaNoteContent(draft: PersonaDraft): string {
  const properties: Record<string, unknown> = { [PERSONA_KEY]: true }
  if (draft.category.trim()) properties.category = draft.category.trim()
  if (draft.description.trim()) properties.description = draft.description.trim()
  if (draft.favorite) properties.favorite = true
  return `---\n${stringifyYaml(properties).trimEnd()}\n---\n\n${draft.instructions.trim()}\n`
}

/** Whether a persona holds every word searched, in its name, category, description or instructions. */
export function matchesPersona(persona: PersonaNote, query: string): boolean {
  const words = fold(query).split(/\s+/).filter(Boolean)
  if (!words.length) return true
  const hay = fold([persona.name, persona.category, persona.description, persona.instructions].join('\n'))
  return words.every((word) => hay.includes(word))
}

/** The categories in use, in alphabetical order, each once whatever its case. */
export function personaCategories(personas: PersonaNote[]): string[] {
  const seen = new Map<string, string>()
  for (const persona of personas) {
    if (persona.category && !seen.has(fold(persona.category))) seen.set(fold(persona.category), persona.category)
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b))
}

/** Personas by category, the favourites first within each, those of no category last. */
export function groupPersonas(personas: PersonaNote[]): { category: string; personas: PersonaNote[] }[] {
  const groups = new Map<string, { category: string; personas: PersonaNote[] }>()
  for (const persona of personas) {
    const key = fold(persona.category)
    const group = groups.get(key) ?? { category: persona.category, personas: [] }
    group.personas.push(persona)
    groups.set(key, group)
  }
  return [...groups.values()]
    .sort((a, b) => (!a.category ? 1 : !b.category ? -1 : a.category.localeCompare(b.category)))
    .map((group) => ({
      ...group,
      personas: group.personas.sort((a, b) => Number(b.favorite) - Number(a.favorite) || a.name.localeCompare(b.name))
    }))
}

/** A note's name from a persona's: what a file name cannot hold taken out. */
export function personaFileName(name: string): string {
  return promptFileName(name)
}

/** What the model is told of the persona it answers as, before anything else it is given. */
export function personaContext(
  persona: Pick<PersonaNote, 'name' | 'instructions'>,
  intro: (name: string) => string
): string {
  return `${intro(persona.name)}\n\n${persona.instructions.trim()}`
}
