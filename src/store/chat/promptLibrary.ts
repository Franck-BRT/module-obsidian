import { stringifyYaml } from 'obsidian'
import { fold } from '../library/libraryDoc'
import { scopeOfWord, type ChatPrompt, type PromptScope } from './chatPrompts'
import { skillBody } from './skills'

/**
 * The prompt library: questions for the chat written once, kept, found again and used.
 *
 * A prompt is a note like any other, found by its `pm-prompt` property wherever it is: its
 * name is the note's, its body the question — as long as it needs to be, with the blanks
 * the ready questions take (`{Depuis le:date}`) —, and a few properties say what it is about
 * (a project, a note, the requirements, a file), which category it is filed under, what it
 * is for, and whether it is a favourite, offered in the chat before anything is asked.
 */

export const PROMPT_KEY = 'pm-prompt'

export interface PromptNote {
  path: string
  name: string
  question: string
  scope: PromptScope
  category: string
  description: string
  favorite: boolean
}

export function isPromptNote(frontmatter: unknown): boolean {
  return (
    !!frontmatter && typeof frontmatter === 'object' && (frontmatter as Record<string, unknown>)[PROMPT_KEY] === true
  )
}

function text(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim() : typeof raw === 'number' ? String(raw) : ''
}

/** A prompt from its note — properties and content; null when the note is not one, or says nothing. */
export function readPromptNote(
  path: string,
  basename: string,
  frontmatter: unknown,
  content: string
): PromptNote | null {
  if (!isPromptNote(frontmatter)) return null
  const fm = frontmatter as Record<string, unknown>
  const question = skillBody(content)
    .replace(/%%[\s\S]*?%%/g, '')
    .trim()
  if (!question) return null
  const about = text(fm.about ?? fm.sujet ?? fm.portee ?? fm['portée'])
  return {
    path,
    name: text(fm.name ?? fm.nom) || basename,
    question,
    scope: (about && scopeOfWord(about)) || 'any',
    category: text(fm.category ?? fm.categorie ?? fm['catégorie']),
    description: text(fm.description),
    favorite: fm.favorite === true || fm.favori === true
  }
}

export interface PromptDraft {
  scope: PromptScope
  /** The word the scope is written with, in the reader's language: « projet ». '' for any. */
  scopeWord: string
  category: string
  description: string
  favorite: boolean
  question: string
}

/** A prompt's note: its properties, then the question. */
export function promptNoteContent(draft: PromptDraft): string {
  const properties: Record<string, unknown> = { [PROMPT_KEY]: true }
  if (draft.scope !== 'any' && draft.scopeWord) properties.about = draft.scopeWord
  if (draft.category.trim()) properties.category = draft.category.trim()
  if (draft.description.trim()) properties.description = draft.description.trim()
  if (draft.favorite) properties.favorite = true
  return `---\n${stringifyYaml(properties).trimEnd()}\n---\n\n${draft.question.trim()}\n`
}

/** The prompt as the chat asks it. */
export function asChatPrompt(prompt: PromptNote): ChatPrompt {
  return { label: prompt.name, question: prompt.question, scope: prompt.scope, own: true }
}

/** Whether a prompt holds every word searched, in its name, category, description or text. */
export function matchesPrompt(prompt: PromptNote, query: string): boolean {
  const words = fold(query).split(/\s+/).filter(Boolean)
  if (!words.length) return true
  const hay = fold([prompt.name, prompt.category, prompt.description, prompt.question].join('\n'))
  return words.every((word) => hay.includes(word))
}

/** The categories in use, in alphabetical order, each once whatever its case. */
export function promptCategories(prompts: PromptNote[]): string[] {
  const seen = new Map<string, string>()
  for (const prompt of prompts) {
    if (prompt.category && !seen.has(fold(prompt.category))) seen.set(fold(prompt.category), prompt.category)
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b))
}

/** Prompts by category, the favourites first within each, those of no category last. */
export function groupPrompts(prompts: PromptNote[]): { category: string; prompts: PromptNote[] }[] {
  const groups = new Map<string, { category: string; prompts: PromptNote[] }>()
  for (const prompt of prompts) {
    const key = fold(prompt.category)
    const group = groups.get(key) ?? { category: prompt.category, prompts: [] }
    group.prompts.push(prompt)
    groups.set(key, group)
  }
  return [...groups.values()]
    .sort((a, b) => (!a.category ? 1 : !b.category ? -1 : a.category.localeCompare(b.category)))
    .map((group) => ({
      ...group,
      prompts: group.prompts.sort((a, b) => Number(b.favorite) - Number(a.favorite) || a.name.localeCompare(b.name))
    }))
}

/** A note's name from a prompt's: what a file name cannot hold taken out. */
export function promptFileName(name: string): string {
  return (
    name
      .replace(/[\\/:*?"<>|#^[\]]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 100) || 'Prompt'
  )
}
