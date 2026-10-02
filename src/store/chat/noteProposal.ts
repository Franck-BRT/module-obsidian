import { normalizePath, stringifyYaml, TFile, type App } from 'obsidian'
import { sanitizeFileName } from '../../utils'
import { freePath } from '../DocumentStore'
import { cleanTags } from '../library/libraryClass'
import { fold, linkPath } from '../library/libraryDoc'
import { ensureFolder } from '../vaultFs'

/**
 * A note the model proposes to write — a meeting's minutes, a summary of a document, a
 * decision — or text it proposes to add to a note that exists.
 *
 * It comes as a `pm-note` block: a few lines saying what the note is — its title, its
 * folder, its tags, or the note to add to —, a line of three dashes, then the note itself
 * in Markdown. Nothing is written until the reader clicks: the block is drawn as a card
 * with the note to be, and a button.
 *
 *     ````pm-note
 *     titre: Compte rendu réunion 12
 *     dossier: Work/Génie civil/CR
 *     tags: cr, chantier
 *     ---
 *     # Compte rendu réunion 12
 *     …
 *     ````
 */

export const NOTE_LANGUAGE = 'pm-note'

export interface NoteProposal {
  title: string
  /** Where it is written; '' for wherever the chat's notes go. */
  folder: string
  /** The note to add to, as the model named it; '' to write a new one. */
  append: string
  /** The note whose transcription is to lose its pages' headers and footers; '' for none. */
  clean: string
  /** The note a section of which is rewritten; '' for none. */
  replace: string
  /** The heading of that section; '' for the whole of the note's text, its properties kept. */
  section: string
  tags: string[]
  body: string
}

/** The header's words, in either language, for what they mean. */
const KEYS: Record<string, keyof Omit<NoteProposal, 'body' | 'tags'> | 'tags'> = {
  titre: 'title',
  title: 'title',
  nom: 'title',
  name: 'title',
  dossier: 'folder',
  folder: 'folder',
  ajouter: 'append',
  'ajouter a': 'append',
  append: 'append',
  'append to': 'append',
  completer: 'append',
  nettoyer: 'clean',
  clean: 'clean',
  'remplacer dans': 'replace',
  remplacer: 'replace',
  'replace in': 'replace',
  replace: 'replace',
  section: 'section',
  rubrique: 'section',
  tags: 'tags',
  etiquettes: 'tags'
}

/** The block, read; null when it names no note to write nor one to add to. */
export function parseNoteProposal(source: string): NoteProposal | null {
  const lines = source.replace(/\r\n?/g, '\n').split('\n')
  const proposal: NoteProposal = {
    title: '',
    folder: '',
    append: '',
    clean: '',
    replace: '',
    section: '',
    tags: [],
    body: ''
  }
  const found = lines.findIndex((line) => /^-{3,}\s*$/.test(line))
  // A note to clean is all header: nothing to write, so no rule under it.
  const dashes = found < 0 && /^\s*(nettoyer|clean)\s*:/im.test(source) ? lines.length : found
  let bodyFrom = 0
  if (dashes >= 0) {
    // Only a header of « key: value » lines counts as one: a note starting with a rule does not.
    const head = lines.slice(0, dashes).filter((line) => line.trim())
    const pairs = head.map((line) => /^\s*([^:]{1,24}):\s*(.*)$/.exec(line))
    if (pairs.every((pair) => pair && KEYS[fold(pair[1]).replace(/\s+/g, ' ').trim()])) {
      for (const pair of pairs) {
        if (!pair) continue
        const key = KEYS[fold(pair[1]).replace(/\s+/g, ' ').trim()]
        const value = pair[2].trim().replace(/^["']|["']$/g, '')
        if (key === 'tags') proposal.tags = cleanTags(value)
        else proposal[key] = value
      }
      bodyFrom = dashes + 1
    }
  }
  proposal.body = lines.slice(bodyFrom).join('\n').trim()
  // No title given: the note's own first heading is its title.
  if (!proposal.title) proposal.title = /^#\s+(.+)$/m.exec(proposal.body)?.[1].trim() ?? ''
  if (proposal.clean) return proposal
  // A section rewritten may be emptied: its new text may be nothing.
  if (proposal.replace) return proposal
  if (!proposal.body || (!proposal.title && !proposal.append)) return null
  return proposal
}

/**
 * A folder the model named, made safe: inside the vault — no way up out of it, no leading
 * slash — and each part a name a file system takes. Empty when it named none.
 */
export function safeFolder(folder: string): string {
  const parts = folder
    .replace(/\\/g, '/')
    .split('/')
    .map((part) => sanitizeFileName(part.trim()))
    .filter((part) => part && part !== '.' && part !== '..')
  return parts.length ? normalizePath(parts.join('/')) : ''
}

/** The new note's text: its tags and the conversation it came from as properties, then the note. */
export function newNoteContent(proposal: NoteProposal, chatPath: string): string {
  const properties: Record<string, unknown> = {}
  if (proposal.tags.length) properties.tags = proposal.tags
  if (chatPath) properties.chat = `[[${chatPath.replace(/\.md$/, '')}]]`
  const head = Object.keys(properties).length ? `---\n${stringifyYaml(properties).trimEnd()}\n---\n\n` : ''
  return `${head}${proposal.body}\n`
}

/** A note's text with the proposed text added at its end, a blank line between. */
export function appendedContent(existing: string, proposal: NoteProposal): string {
  return `${existing.trimEnd()}\n\n${proposal.body}\n`
}

/**
 * Whether a note already holds the proposed text: a card applied once says so — its
 * headings at whatever level they were put, text added into a section stepping them down.
 */
export function holdsProposal(existing: string, proposal: NoteProposal): boolean {
  const squeeze = (text: string): string =>
    text
      .replace(/^[ \t]*#{1,6}[ \t]+/gm, '')
      .replace(/\s+/g, ' ')
      .trim()
  return squeeze(existing).includes(squeeze(proposal.body))
}

/** Where a new note goes: the folder it names — « / » for the vault's root —, or the one given for the chat's notes. */
export function proposalFolder(proposal: NoteProposal, fallback: string): string {
  if (proposal.folder.trim() === '/') return ''
  return safeFolder(proposal.folder) || safeFolder(fallback)
}

/**
 * The block with the folder its note goes to changed — « / » for the vault's root —: its
 * « dossier » line rewritten, or added to its header, or a header given to a block that
 * had none.
 */
export function withFolder(source: string, folder: string): string {
  const lines = source.replace(/\r\n?/g, '\n').split('\n')
  const value = folder.trim() || '/'
  const dashes = lines.findIndex((line) => /^-{3,}\s*$/.test(line))
  const header = dashes >= 0 ? lines.slice(0, dashes) : []
  const isHeader =
    dashes >= 0 &&
    header
      .filter((line) => line.trim())
      .every((line) => {
        const pair = /^\s*([^:]{1,24}):/.exec(line)
        return !!pair && !!KEYS[fold(pair[1]).replace(/\s+/g, ' ').trim()]
      })
  if (!isHeader) {
    const title = parseNoteProposal(source)?.title ?? ''
    return [...(title ? [`titre: ${title}`] : []), `dossier: ${value}`, '---', ...lines].join('\n')
  }
  const at = header.findIndex((line) => {
    const pair = /^\s*([^:]{1,24}):/.exec(line)
    return !!pair && KEYS[fold(pair[1]).replace(/\s+/g, ' ').trim()] === 'folder'
  })
  if (at >= 0) lines[at] = `dossier: ${value}`
  else lines.splice(dashes, 0, `dossier: ${value}`)
  return lines.join('\n')
}

/** The note a proposal adds to, found as Obsidian finds a link. */
export function appendTarget(app: App, proposal: NoteProposal, from: string): TFile | null {
  return noteNamed(app, proposal.append, from)
}

/** A note the model named, by a link or a path, found as Obsidian finds a link. */
export function noteNamed(app: App, name: string, from: string): TFile | null {
  const path = linkPath(name)
  if (!path) return null
  const found = app.metadataCache.getFirstLinkpathDest(path, from)
  if (found) return found
  const direct = app.vault.getAbstractFileByPath(normalizePath(path.endsWith('.md') ? path : `${path}.md`))
  return direct instanceof TFile ? direct : null
}

/**
 * The note a proposal was already written as — same folder, its title's name or the name
 * a second one would have taken — found by holding the proposed text; null when none does.
 */
export async function writtenNote(app: App, proposal: NoteProposal, fallback: string): Promise<TFile | null> {
  const folder = proposalFolder(proposal, fallback)
  const base = sanitizeFileName(proposal.title).trim() || 'Note'
  for (let n = 0; n < 5; n++) {
    const path = normalizePath(`${folder ? `${folder}/` : ''}${base}${n ? `-${n}` : ''}.md`)
    const file = app.vault.getAbstractFileByPath(path)
    if (file instanceof TFile && holdsProposal(await app.vault.cachedRead(file), proposal)) return file
  }
  return null
}

/**
 * The note of the proposed note's name, there already in the folder it would go to —
 * whatever it says now —; null when the name is free.
 */
export function noteAtTitle(app: App, proposal: NoteProposal, fallback: string): TFile | null {
  const folder = proposalFolder(proposal, fallback)
  const base = sanitizeFileName(proposal.title).trim() || 'Note'
  const file = app.vault.getAbstractFileByPath(normalizePath(`${folder ? `${folder}/` : ''}${base}.md`))
  return file instanceof TFile ? file : null
}

/** The `pm-note` blocks of a reply, their text as written between the fences. */
export function noteBlocks(reply: string): string[] {
  const out: string[] = []
  for (const found of reply.matchAll(/^(`{3,})\s*pm-note[^\n]*\n([\s\S]*?)^\1\s*$/gm)) out.push(found[2])
  return out
}

/** Writes the proposed note, never over another: a name taken gets a number. */
export async function writeProposedNote(
  app: App,
  proposal: NoteProposal,
  fallback: string,
  chatPath: string
): Promise<TFile> {
  const folder = proposalFolder(proposal, fallback)
  if (folder) await ensureFolder(app, folder)
  const path = await freePath(app, folder, sanitizeFileName(proposal.title).trim() || 'Note', 'md')
  return app.vault.create(path, newNoteContent(proposal, chatPath))
}

/** Adds the proposed text at the end of a note. */
export async function appendProposal(app: App, target: TFile, proposal: NoteProposal): Promise<void> {
  await app.vault.process(target, (existing) => appendedContent(existing, proposal))
}

/** Where a section of a note is: its heading's line, where its text starts, and where it ends. */
export interface SectionAt {
  heading: string
  /** Where its text starts: just after its heading's line. */
  start: number
  /** Where it ends: the next heading of its level or above, or the note's end. */
  end: number
}

const HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/

/** The headings of a note, outside its properties and code, in order. */
export function sectionTitles(content: string): string[] {
  return headings(content).map((one) => one.title)
}

function headings(content: string): { at: number; end: number; level: number; title: string }[] {
  const found: { at: number; end: number; level: number; title: string }[] = []
  let at = 0
  let fence = false
  const front = /^---\r?\n[\s\S]*?\r?\n---(\r?\n|$)/.exec(content)
  if (front) at = front[0].length
  while (at < content.length) {
    const next = content.indexOf('\n', at)
    const end = next < 0 ? content.length : next + 1
    const line = content.slice(at, next < 0 ? content.length : next)
    if (/^\s*(```|~~~)/.test(line)) fence = !fence
    const match = fence ? null : HEADING.exec(line)
    if (match) found.push({ at, end, level: match[1].length, title: match[2].trim() })
    at = end
  }
  return found
}

/**
 * A section of a note, found by its heading as the model named it — case, accents and a
 * leading « # » aside. Null when the note has none of that title, or more than one.
 */
export function findSection(content: string, title: string): SectionAt | null {
  const wanted = fold(title.replace(/^#+\s*/, '').trim())
  const all = headings(content)
  const matches = all.filter((one) => fold(one.title) === wanted)
  if (matches.length !== 1) return null
  const heading = matches[0]
  const after = all.find((one) => one.at > heading.at && one.level <= heading.level)
  return { heading: heading.title, start: heading.end, end: after ? after.at : content.length }
}

/** Where the whole of a note's text is, its properties left out. */
function bodyAt(content: string): { start: number; end: number } {
  const front = /^---\r?\n[\s\S]*?\r?\n---(\r?\n|$)/.exec(content)
  return { start: front ? front[0].length : 0, end: content.length }
}

/** A section's text — or the note's, properties aside — as it reads now; null when there is no such section. */
export function sectionText(content: string, title: string): string | null {
  const at = title.trim() ? findSection(content, title) : bodyAt(content)
  return at ? content.slice(at.start, at.end).trim() : null
}

/**
 * The note with a section's text replaced — its heading kept, a blank line around the new
 * text — or, with no section named, all its text, its properties kept. Null when the
 * section is not found.
 */
export function replaceSection(content: string, title: string, text: string): string | null {
  const at = title.trim() ? findSection(content, title) : bodyAt(content)
  if (!at) return null
  const body = text.trim()
  const before = content.slice(0, at.start)
  // The whole text: after the properties, as the note's own.
  if (!title.trim()) return `${before}${before && body ? '\n' : ''}${body ? `${body}\n` : ''}`
  const rest = content.slice(at.end)
  return `${before}${body ? `\n${body}\n` : ''}${rest ? '\n' : ''}${rest}`
}

/**
 * Text to go into a section, its headings stepped under the section's own: what was
 * written for the end of a note under « ## » goes under « ### Bétons » as « #### ». Code
 * is left as it is.
 */
export function underSection(content: string, title: string, text: string): string | null {
  const at = findSection(content, title)
  if (!at) return null
  const level = headings(content).find((one) => one.end === at.start)?.level ?? 1
  const lines = text.trim().split('\n')
  let fence = false
  const levels = lines
    .map((line) => {
      if (/^\s*(```|~~~)/.test(line)) fence = !fence
      return fence ? null : (HEADING.exec(line)?.[1].length ?? null)
    })
    .filter((found): found is number => found !== null)
  if (!levels.length) return text.trim()
  const shift = level + 1 - Math.min(...levels)
  fence = false
  return lines
    .map((line) => {
      if (/^\s*(```|~~~)/.test(line)) fence = !fence
      const heading = fence ? null : HEADING.exec(line)
      if (!heading) return line
      const depth = Math.min(6, Math.max(1, heading[1].length + shift))
      return `${'#'.repeat(depth)} ${heading[2]}`
    })
    .join('\n')
}

/**
 * The note with text added at the end of one of its sections — before the next heading of
 * its level or above —, its headings stepped under the section's. Null when the section
 * is not found.
 */
export function appendToSection(content: string, title: string, text: string): string | null {
  const at = findSection(content, title)
  const body = underSection(content, title, text)
  if (!at || body === null) return null
  const before = content.slice(0, at.end).trimEnd()
  const rest = content.slice(at.end)
  return `${before}\n\n${body}\n${rest ? `\n${rest}` : ''}`
}

/**
 * The section of a note that text proposed for its end is most likely about: the one
 * whose title its first heading holds — « Approfondissement : article 2 – Bétons » for
 * « Bétons » —, the longest title first. Null when none does, or the text has no heading.
 */
export function sectionFor(content: string, text: string): string | null {
  const first = /^#{1,6}\s+(.+)$/m.exec(text)?.[1]
  if (!first) return null
  const words = (value: string): string =>
    ` ${fold(value)
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim()} `
  const wanted = words(first)
  const titles = sectionTitles(content)
    .filter((title) => title.replace(/[^\p{L}\p{N}]/gu, '').length >= 4 && wanted.includes(words(title)))
    // The note's own title — its first heading — is about everything, so about nothing.
    .filter((title) => title !== sectionTitles(content)[0] || sectionTitles(content).length === 1)
    .sort((a, b) => b.length - a.length)
  const best = titles[0]
  if (!best || titles.filter((title) => title.length === best.length).length > 1) return null
  return findSection(content, best) ? best : null
}

/** Whether a section holds what the plugin keeps for itself, which a rewrite would break. */
export function holdsKept(text: string): boolean {
  return text.includes('%% pm-transcript')
}
