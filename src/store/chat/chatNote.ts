import { parseFrontmatter } from '../YamlParser'
import type { ChatTurn } from './chatSession'

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
}

export interface ChatNote extends ChatNoteMeta {
  turns: ChatTurn[]
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

/** One turn, as its callout. */
export function turnMarkdown(turn: ChatTurn, words: ChatNoteWords): string {
  const head = `> [!${CALLOUT[turn.role]}] ${turn.role === 'user' ? words.user : words.assistant} · ${localStamp(turn.at)}`
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
      current = { turn: { role, content: '', at: fromStamp(start[2]) ?? created }, lines: [] }
    } else if (current && line.startsWith('>')) current.lines.push(line.replace(/^> ?/, ''))
    else close()
    previous = line
  }
  close()
  return { title: text('title'), model: text('model'), created, turns }
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
