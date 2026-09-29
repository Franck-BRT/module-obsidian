import { stringifyYaml } from 'obsidian'
import { fold } from '../library/libraryDoc'

/**
 * Skills: what the chat is to do for a kind of request, written once as a note and used
 * whenever that request comes — how minutes are written here, what a decision sheet holds,
 * where such notes go.
 *
 * A skill is a note like any other, found by its `pm-skill` property wherever it is: a
 * description saying what it is for, the words a question calls it by, the folder the notes
 * it produces go to, and its body — the instructions, a model of the note — in plain
 * Markdown, for the reader to write and to change. One is taken up by hand from the chat,
 * or by itself when a question says one of its words; its instructions then go with every
 * question until it is taken off.
 */

export const SKILL_KEY = 'pm-skill'

export interface Skill {
  path: string
  name: string
  description: string
  /** Folded words or phrases a question calls it by. */
  triggers: string[]
  /** Where the notes it produces go; '' where the chat's go. */
  folder: string
}

export function isSkill(frontmatter: unknown): boolean {
  return (
    !!frontmatter && typeof frontmatter === 'object' && (frontmatter as Record<string, unknown>)[SKILL_KEY] === true
  )
}

function text(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim() : ''
}

/** A list written as a list or as one line of commas. */
function list(raw: unknown): string[] {
  const entries = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(',') : []
  return entries
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => fold(entry).trim())
    .filter(Boolean)
}

/** A skill from its note's properties; null when the note is not one. */
export function readSkill(path: string, basename: string, frontmatter: unknown): Skill | null {
  if (!isSkill(frontmatter)) return null
  const fm = frontmatter as Record<string, unknown>
  return {
    path,
    name: text(fm.name ?? fm.nom) || basename,
    description: text(fm.description),
    triggers: list(fm.triggers ?? fm.declencheurs ?? fm['déclencheurs']),
    folder: text(fm.folder ?? fm.dossier)
  }
}

/** Words as a question is read for its triggers: folded, one space between, a space at each end. */
function words(text: string): string {
  return ` ${fold(text)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .join(' ')} `
}

/**
 * The skills a question calls by one of their words — whole words and phrases only, so
 * « cr » is heard in « fais le CR » and not in « écran ».
 */
export function calledSkills(skills: Skill[], question: string): Skill[] {
  const asked = words(question)
  return skills.filter((skill) => skill.triggers.some((trigger) => asked.includes(` ${words(trigger).trim()} `)))
}

/** A skill's instructions: its note without its properties. */
export function skillBody(content: string): string {
  const match = /^---\n[\s\S]*?\n---\n?/.exec(content.replace(/\r\n?/g, '\n'))
  return (match ? content.replace(/\r\n?/g, '\n').slice(match[0].length) : content).trim()
}

export interface SkillWords {
  heading: (name: string) => string
  folder: (folder: string) => string
}

/** The skills in use, for the instructions: each with its name, its folder, and what it says to do. */
export function skillsContext(skills: { skill: Skill; body: string }[], words: SkillWords): string {
  return skills
    .filter((entry) => entry.body)
    .map(({ skill, body }) =>
      [
        words.heading(skill.name),
        skill.folder ? words.folder(skill.folder) : '',
        `<skill name="${skill.name}">\n${body}\n</skill>`
      ]
        .filter(Boolean)
        .join('\n')
    )
    .join('\n\n')
}

export interface SkillDraft {
  name: string
  description: string
  triggers: string[]
  folder: string
  body: string
}

/** A skill's note: its properties, then its instructions. */
export function skillNote(draft: SkillDraft): string {
  const properties = {
    [SKILL_KEY]: true,
    description: draft.description,
    triggers: draft.triggers,
    folder: draft.folder
  }
  return `---\n${stringifyYaml(properties).trimEnd()}\n---\n\n${draft.body.trim()}\n`
}
