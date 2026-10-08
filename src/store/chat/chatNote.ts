import { parseFrontmatter } from '../YamlParser'
import type { ChatTurn } from './chatSession'
import { currentThread } from './chatBranches'

export { currentThread } from './chatBranches'

/**
 * A conversation kept as a note.
 *
 * Written for a reader first: each turn is a callout — a question, then the reply under
 * it — so the note reads as the conversation did, and a reply's lists, tables and code
 * render as they did in the panel. Written for the plugin second: the callout's type says
 * who spoke and its title says when, which is all it takes to read the note back and go
 * on with the conversation.
 *
 * Only what was said is kept. A reply that failed is the panel's business, not the
 * record's.
 */

/** A question is a `question` callout, a reply a `note` one: both render in any theme. */
const CALLOUT: Record<ChatTurn['role'], string> = { user: 'question', assistant: 'note' }
const ROLE_OF: Record<string, ChatTurn['role']> = { question: 'user', note: 'assistant' }

export interface ChatNoteMeta {
  title: string
  model: string
  created: string
}

/** What each speaker is called in the note, in the reader's language. */
export interface ChatNoteWords {
  user: string
  assistant: string
  /** A requirement as the note shows it: a link to its note where there is one. */
  requirement?: (id: string) => string
}

/** What marks the requirements a question was asked about, in its callout's title. */
const REQUIREMENTS_MARK = '📋'
/** What marks the project a question was asked about. */
const PROJECT_MARK = '📁'
/** What marks the files a question was asked with. */
const FILES_MARK = '📎'
/** What marks the collections a question was asked about. */
const COLLECTION_MARK = '🗂'
/** What marks the skills a question was asked with. */
const SKILL_MARK = '✨'
/** What marks the persona a question was asked of. */
const PERSONA_MARK = '🎭'
/** What marks a question asked of the whole library, before the sources its passages came from. */
const LIBRARY_MARK = '📚'
/** What marks a question asked again in place of an earlier one, before that one's time. */
const RETAKE_MARK = '↻'
/** What marks a question asked after going back to an earlier branch, before where it goes on from. */
const FOLLOWS_MARK = '↪'
/** The marks after which a link is not the note the question was about. */
const MARKS = [REQUIREMENTS_MARK, PROJECT_MARK, FILES_MARK, COLLECTION_MARK, SKILL_MARK, PERSONA_MARK, LIBRARY_MARK]

export interface ChatNote extends ChatNoteMeta {
  /** The thread the conversation goes on from. */
  turns: ChatTurn[]
  /** Every exchange the note holds, every branch, in the order they were had. */
  all: ChatTurn[]
}

const two = (value: number): string => String(value).padStart(2, '0')

/** A moment as the reader's clock shows it, to the minute: `2026-09-25 10:03`. */
export function localStamp(iso: string): string {
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return ''
  return `${at.getFullYear()}-${two(at.getMonth() + 1)}-${two(at.getDate())} ${two(at.getHours())}:${two(at.getMinutes())}`
}

/** The same, read back: the reader's clock, to the minute. */
function fromStamp(text: string): string | undefined {
  const found = /(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})/.exec(text)
  if (!found) return undefined
  const [, y, mo, d, h, mi] = found.map(Number)
  return new Date(y, mo - 1, d, h, mi).toISOString()
}

/**
 * A link to a note by its path, shown by its name: `[[Specs/Thermique|Thermique]]`. Any
 * other file keeps its extension, since that is how Obsidian links to it.
 */
export function noteLink(path: string): string {
  const target = path.replace(/\.md$/i, '')
  const name = target.slice(target.lastIndexOf('/') + 1)
  return target === name ? `[[${target}]]` : `[[${target}|${name}]]`
}

/** A source a question was answered from, by its whole path — a document is not a note — and its name. */
function sourceLink(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/i, '')
  return `[[${path}|${name}]]`
}

/** The requirements a callout's title names after its mark, by identifier. */
function namedRequirements(title: string): string[] {
  const segment = title.split(' · ').find((part) => part.trim().startsWith(REQUIREMENTS_MARK))
  if (!segment) return []
  return segment
    .trim()
    .slice(REQUIREMENTS_MARK.length)
    .split(',')
    .map((piece) => {
      // A link shows the identifier as its alias; a bare one is the identifier itself.
      const link = /\[\[([^\]|]*)(?:\|([^\]]*))?\]\]/.exec(piece)
      const text = link ? (link[2] ?? link[1].slice(link[1].lastIndexOf('/') + 1)) : piece
      return text.trim().split(/\s+/)[0] ?? ''
    })
    .filter(Boolean)
}

/** A link's target as a note's path: `[[Specs/Thermique|…]]` is `Specs/Thermique.md`. */
function pathIn(text: string): string | undefined {
  const found = /\[\[([^\]|#]+)(?:[#|][^\]]*)?\]\]/.exec(text)
  if (!found) return undefined
  const target = found[1].trim()
  return /\.md$/i.test(target) ? target : `${target}.md`
}

/** The note a callout's title links to, as a path; the first link, where there are several. */
function linkedPath(title: string): string | undefined {
  // The requirements', the project's and the files' links are theirs, not the note's.
  return pathIn(
    title
      .split(' · ')
      .filter((part) => !MARKS.some((mark) => part.trim().startsWith(mark)))
      .join(' · ')
  )
}

/** The time a mark in a question's title names: the question retaken, or gone on from. */
function marked(title: string, mark: string): string | undefined {
  const segment = title.split(' · ').find((part) => part.trim().startsWith(mark))
  return segment ? fromStamp(segment) : undefined
}

/** The model a reply's title names after its time: `Assistant · 2026-09-28 14:10 · qwen3`. */
function writtenBy(title: string): string | undefined {
  const parts = title.split(' · ').map((part) => part.trim())
  const at = parts.findIndex((part) => /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(part))
  const model = at >= 0 ? parts[at + 1] : undefined
  return model && !model.includes('[[') ? model : undefined
}

/** The files a callout's title names after its mark, by path. */
function namedFiles(title: string, mark = FILES_MARK): string[] {
  const segment = title.split(' · ').find((part) => part.trim().startsWith(mark))
  if (!segment) return []
  return [...segment.matchAll(/\[\[([^\]|#]+)(?:[#|][^\]]*)?\]\]/g)].map((found) => found[1].trim())
}

/** The notes a callout's title names after a mark — projects, collections — as paths. */
function namedNotes(title: string, mark: string): string[] {
  const segment = title.split(' · ').find((part) => part.trim().startsWith(mark))
  if (!segment) return []
  return segment
    .split(/\]\]\s*,/)
    .map((piece) => pathIn(piece.trim().endsWith(']]') ? piece : `${piece}]]`))
    .filter((path): path is string => !!path)
}

/** One turn, as its callout. */
export function turnMarkdown(turn: ChatTurn, words: ChatNoteWords): string {
  // The note a question was asked about, as a link: the record says what the model was
  // shown, and the reader can go to it.
  const link = words.requirement ?? ((id: string) => id)
  const about =
    (turn.context ? ` · ${noteLink(turn.context)}` : '') +
    (turn.projects?.length ? ` · ${PROJECT_MARK} ${turn.projects.map(noteLink).join(', ')}` : '') +
    (turn.collections?.length ? ` · ${COLLECTION_MARK} ${turn.collections.map(noteLink).join(', ')}` : '') +
    (turn.files?.length ? ` · ${FILES_MARK} ${turn.files.map(noteLink).join(', ')}` : '') +
    (turn.skills?.length ? ` · ${SKILL_MARK} ${turn.skills.map(noteLink).join(', ')}` : '') +
    (turn.persona ? ` · ${PERSONA_MARK} ${noteLink(turn.persona)}` : '') +
    (turn.library ? ` · ${[LIBRARY_MARK, turn.library.map(sourceLink).join(', ')].filter(Boolean).join(' ')}` : '') +
    (turn.requirements?.length ? ` · ${REQUIREMENTS_MARK} ${turn.requirements.map(link).join(', ')}` : '')
  // A reply says which model wrote it: a conversation may change model on the way, and
  // two answers to one question are compared knowing whose they are.
  const by = turn.role === 'assistant' && turn.model ? ` · ${turn.model}` : ''
  const retake =
    turn.role !== 'user'
      ? ''
      : turn.retakes
        ? ` · ${RETAKE_MARK} ${localStamp(turn.retakes)}`
        : turn.follows
          ? ` · ${FOLLOWS_MARK} ${localStamp(turn.follows)}`
          : ''
  const head = `> [!${CALLOUT[turn.role]}] ${turn.role === 'user' ? words.user : words.assistant} · ${localStamp(turn.at)}${about}${retake}${by}`
  const body = turn.content.split('\n').map((line) => (line === '' ? '>' : `> ${line}`))
  return [head, ...body].join('\n')
}

function turnsMarkdown(turns: ChatTurn[], words: ChatNoteWords): string {
  return turns
    .filter((turn) => !turn.failed && turn.content.trim() !== '')
    .map((turn) => turnMarkdown(turn, words))
    .join('\n\n')
}

/** A new note: what it is, then its title, then the turns so far. */
export function chatNoteContent(meta: ChatNoteMeta, turns: ChatTurn[], words: ChatNoteWords): string {
  return [
    '---',
    'pm-chat: true',
    `title: ${JSON.stringify(meta.title)}`,
    `created: ${JSON.stringify(meta.created)}`,
    `model: ${JSON.stringify(meta.model)}`,
    '---',
    '',
    `# ${meta.title}`,
    '',
    turnsMarkdown(turns, words),
    ''
  ].join('\n')
}

/**
 * The note with more turns at its end.
 *
 * Added, never rewritten: the reader may have edited the note since — trimmed a reply,
 * written a line of their own under it — and a save that rewrote the note from what the
 * panel remembers would quietly undo that.
 */
export function appendTurns(content: string, turns: ChatTurn[], words: ChatNoteWords): string {
  const added = turnsMarkdown(turns, words)
  if (!added) return content
  return `${content.replace(/\s+$/, '')}\n\n${added}\n`
}

const START = /^>\s*\[!([\w-]+)\][+-]?\s*(.*)$/

/**
 * A note read back into a conversation.
 *
 * A callout opens a turn only after a line that is not part of a callout, so a reply
 * that itself quotes `[!question]` stays one reply. Anything outside the callouts — the
 * title, a line the reader added — is the reader's, and is left in the note unread.
 */
export function readChatNote(content: string): ChatNote {
  const { frontmatter, body } = parseFrontmatter(content)
  const text = (key: string): string => {
    const value = frontmatter?.[key]
    return typeof value === 'string' ? value : ''
  }
  const created = text('created')
  const turns: ChatTurn[] = []
  let current: { turn: ChatTurn; lines: string[] } | null = null
  let previous = ''

  const close = (): void => {
    if (!current) return
    while (current.lines.length && current.lines[current.lines.length - 1] === '') current.lines.pop()
    current.turn.content = current.lines.join('\n')
    if (current.turn.content.trim()) turns.push(current.turn)
    current = null
  }

  for (const line of body.split('\n')) {
    const start = START.exec(line)
    const role = start ? ROLE_OF[start[1].toLowerCase()] : undefined
    if (start && role && !previous.startsWith('>')) {
      close()
      const context = role === 'user' ? linkedPath(start[2]) : undefined
      const requirements = role === 'user' ? namedRequirements(start[2]) : []
      const projects = role === 'user' ? namedNotes(start[2], PROJECT_MARK) : []
      const collections = role === 'user' ? namedNotes(start[2], COLLECTION_MARK) : []
      const files = role === 'user' ? namedFiles(start[2]) : []
      const skills = role === 'user' ? namedNotes(start[2], SKILL_MARK) : []
      const persona = role === 'user' ? namedNotes(start[2], PERSONA_MARK)[0] : undefined
      const library =
        role === 'user' && start[2].split(' · ').some((part) => part.trim().startsWith(LIBRARY_MARK))
          ? namedFiles(start[2], LIBRARY_MARK)
          : undefined
      const model = role === 'assistant' ? writtenBy(start[2]) : undefined
      const retakes = role === 'user' ? marked(start[2], RETAKE_MARK) : undefined
      const follows = role === 'user' && !retakes ? marked(start[2], FOLLOWS_MARK) : undefined
      current = {
        turn: {
          role,
          content: '',
          at: fromStamp(start[2]) ?? created,
          ...(context ? { context } : {}),
          ...(projects.length ? { projects } : {}),
          ...(collections.length ? { collections } : {}),
          ...(files.length ? { files } : {}),
          ...(skills.length ? { skills } : {}),
          ...(persona ? { persona } : {}),
          ...(library ? { library } : {}),
          ...(model ? { model } : {}),
          ...(retakes ? { retakes } : {}),
          ...(follows ? { follows } : {}),
          ...(requirements.length ? { requirements } : {})
        },
        lines: []
      }
    } else if (current && line.startsWith('>')) current.lines.push(line.replace(/^> ?/, ''))
    else close()
    previous = line
  }
  close()
  return { title: text('title'), model: text('model'), created, turns: currentThread(turns), all: turns }
}

/** The block a conversation's note draws its branches with. */
export const BRANCHES_LANGUAGE = 'pm-chat-branches'

/** Whether a turn starts a branch: a question asked again, or asked after going back. */
export function branches(turn: ChatTurn): boolean {
  return turn.role === 'user' && !!(turn.retakes || turn.follows)
}

/**
 * The note with the block that draws its branches, under its title — once, when the
 * conversation first branches: a conversation that never did has nothing to draw, and
 * its note stays as it was.
 */
export function withBranchBlock(content: string): string {
  if (new RegExp('^```' + BRANCHES_LANGUAGE + '\\s*$', 'm').test(content)) return content
  const block = '```' + BRANCHES_LANGUAGE + '\n```'
  const lines = content.split('\n')
  let at = 0
  if (lines[0] === '---') {
    const end = lines.indexOf('---', 1)
    at = end >= 0 ? end + 1 : 0
  }
  const title = lines.findIndex((line, index) => index >= at && /^# /.test(line))
  const after = title >= 0 ? title + 1 : at
  lines.splice(after, 0, '', block)
  return lines.join('\n')
}

/** Whether a note's front matter says it is a conversation. */
export function isChatNote(frontmatter: Record<string, unknown> | undefined): boolean {
  return frontmatter?.['pm-chat'] === true
}

/**
 * A conversation's title: its first question, cut at a word, on one line.
 *
 * The question rather than a summary asked of the model: it costs nothing, it is never
 * wrong about what was asked, and the reader recognises their own words in a list.
 */
export function chatTitle(question: string, fallback: string): string {
  const line = question.replace(/\s+/g, ' ').trim()
  if (!line) return fallback
  if (line.length <= 60) return line
  const cut = line.slice(0, 60)
  const space = cut.lastIndexOf(' ')
  return `${(space > 30 ? cut.slice(0, space) : cut).replace(/[\s,;:.]+$/, '')}…`
}

/** A file name for the note: the moment it began, then its title, with nothing a vault refuses. */
export function chatNoteName(title: string, created: string): string {
  const safe = title
    .replace(/[\\/:*?"<>|#^[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/, '')
    .trim()
  const stamp = localStamp(created).replace(':', 'h')
  return safe ? `${stamp} ${safe}` : stamp
}
