import { CHANGE_LANGUAGE } from './chatChange'

/**
 * A reply, made into a note of its own or put into the note being written.
 *
 * A progress report the model wrote is worth keeping where the project's notes are, not
 * only in the record of the conversation that produced it. What goes is the prose: the
 * change blocks are actions to take in the plugin, and a JSON object in the middle of a
 * report sent to a committee is noise.
 */

/** The reply without its change blocks, and without the blank lines they leave behind. */
export function withoutChangeBlocks(text: string): string {
  const out: string[] = []
  let open: { fence: string; change: boolean } | null = null
  for (const line of text.split('\n')) {
    const fence = /^[ \t]*(`{3,}|~{3,})(.*)$/.exec(line)
    if (!open) {
      if (fence) {
        open = { fence: fence[1], change: fence[2].trim() === CHANGE_LANGUAGE }
        if (open.change) continue
      }
      out.push(line)
      continue
    }
    const closes = fence && fence[1][0] === open.fence[0] && fence[1].length >= open.fence.length && !fence[2].trim()
    if (!open.change) out.push(line)
    if (closes) open = null
  }
  return out
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * What the note is called: the reply's first heading when it has one — a report usually
 * starts with its title — and otherwise the question it answers, cut to a title.
 */
export function replyTitle(reply: string, fallback: string): string {
  const heading = /^#{1,3}\s+(.+?)\s*#*\s*$/m.exec(reply)
  const title = (heading ? heading[1] : fallback)
    .replace(/[*_`[\]]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (title.length <= 80) return title
  const cut = title.slice(0, 80)
  const space = cut.lastIndexOf(' ')
  return `${(space > 40 ? cut.slice(0, space) : cut).replace(/[\s,;:.]+$/, '')}…`
}

export interface ReplyNoteMeta {
  created: string
  model: string
  /** The conversation it came from, as a path, when it has been saved. */
  chat?: string
  /** The project it was about, as a path. */
  project?: string
}

const link = (path: string): string => `"[[${path.replace(/\.md$/i, '')}]]"`

/** The note: where it came from in its front matter, then the reply as it reads. */
export function replyNoteContent(meta: ReplyNoteMeta, body: string): string {
  return [
    '---',
    `created: ${JSON.stringify(meta.created)}`,
    ...(meta.project ? [`project: ${link(meta.project)}`] : []),
    ...(meta.chat ? [`chat: ${link(meta.chat)}`] : []),
    `model: ${JSON.stringify(meta.model)}`,
    '---',
    '',
    body,
    ''
  ].join('\n')
}
