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
  tags: 'tags',
  etiquettes: 'tags'
}

/** The block, read; null when it names no note to write nor one to add to. */
export function parseNoteProposal(source: string): NoteProposal | null {
  const lines = source.replace(/\r\n?/g, '\n').split('\n')
  const proposal: NoteProposal = { title: '', folder: '', append: '', tags: [], body: '' }
  const dashes = lines.findIndex((line) => /^-{3,}\s*$/.test(line))
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

/** Whether a note already holds the proposed text: a card applied once says so. */
export function holdsProposal(existing: string, proposal: NoteProposal): boolean {
  const squeeze = (text: string): string => text.replace(/\s+/g, ' ').trim()
  return squeeze(existing).includes(squeeze(proposal.body))
}

/** Where a new note goes: the folder it names, or the one given for the chat's notes. */
export function proposalFolder(proposal: NoteProposal, fallback: string): string {
  return safeFolder(proposal.folder) || safeFolder(fallback)
}

/** The note a proposal adds to, found as Obsidian finds a link. */
export function appendTarget(app: App, proposal: NoteProposal, from: string): TFile | null {
  const path = linkPath(proposal.append)
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
