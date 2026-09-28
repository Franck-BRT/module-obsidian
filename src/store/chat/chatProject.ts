import type { PriorityConfig, Project, StatusConfig, Task } from '../../types'
import { isTerminalStatus } from '../../utils'
import { documentOf, isDocument } from '../Document'
import { projectMetrics } from '../Metrics'
import { isPhase, phaseSpan } from '../Phase'

/**
 * A project, written out for a model to read.
 *
 * What someone asked "where does this project stand?" would want in front of them: the
 * figures the dashboard shows, then every ticket in the project's own tree, each on one
 * line with what matters about it — its state, its dates, who has it, what it waits for,
 * and whether it is late, said in words rather than left for the model to work out from
 * a date it may compare wrongly.
 *
 * Read from the notes' front matter only. A ticket's description is the reader's prose,
 * as long as they like; a hundred of them would crowd out the plan itself.
 */

/** One project's tickets; a programme is several, each under its own name. */
export interface ProjectPart {
  title: string
  path: string
  tasks: Task[]
}

export interface ProjectContextInput {
  title: string
  path: string
  program: boolean
  description: string
  team: string[]
  zones: string[]
  parts: ProjectPart[]
  statuses: StatusConfig[]
  priorities: PriorityConfig[]
  today: string
  /** A ticket outside these projects, by its title: what a dependency on it is called. */
  titleOf?: (id: string) => string | undefined
}

/** The reader's words, so the model is told about the project in their language. */
export interface ProjectWords {
  heading: (title: string, path: string) => string
  program: string
  field: {
    description: string
    team: string
    zones: string
    span: string
    summary: string
    tickets: string
  }
  /** The headline figures, as one sentence. */
  summary: (figures: { total: number; done: number; progress: number; late: number; soon: number }) => string
  /** A kind of ticket other than a plain task, by its name: `Jalon`, `Lot`. */
  type: (type: string) => string
  docState: (state: string) => string
  late: string
  after: string
  /** What introduces a document's reference, its revision mark and its file. */
  reference: string
  issue: string
  file: string
  noTickets: string
  /** What is said when finished tickets were left out to make room. */
  doneLeft: (count: number) => string
  /** What is said when tickets were cut, however many there were. */
  left: (count: number) => string
}

/**
 * How much of a project goes with a question, in characters: some two hundred tickets
 * written out, beside the conversation and anything else attached.
 */
export const PROJECT_BUDGET = 20000

/** How much of the project's own description is kept: its opening, which says what it is. */
const DESCRIPTION_BUDGET = 1500

function span(start: string, due: string): string {
  if (start && due && start !== due) return `${start} → ${due}`
  return due || start
}

/**
 * One ticket, on one line, indented under the ticket it sits under.
 *
 * Named by its title, never by its identifier: a ticket's identifier is a random string
 * the plugin keys it by, which means nothing to the reader, and a model shown it quotes
 * it back. A dependency is named the same way, by the title of the ticket it waits for.
 */
function ticketLine(
  task: Task,
  depth: number,
  input: ProjectContextInput,
  words: ProjectWords,
  nameOf: (id: string) => string | undefined
): string {
  const facts: string[] = []
  if (isPhase(task)) {
    const phase = phaseSpan(task, input.statuses)
    facts.push(words.type('phase'))
    const when = span(phase.start, phase.due)
    if (when) facts.push(when)
    if (phase.count) facts.push(`${phase.progress} %`)
    return `${'  '.repeat(depth)}- ${task.title} · ${facts.join(' · ')}`
  }
  if (task.type !== 'task' && task.type !== 'subtask') facts.push(words.type(task.type))
  if (isDocument(task)) {
    // What a document is known by in the trade — its reference, its revision, its file.
    const meta = documentOf(task)
    facts.push(words.docState(meta.state))
    if (meta.reference.trim()) facts.push(`${words.reference} ${meta.reference.trim()}`)
    if (meta.issue.trim()) facts.push(`${words.issue} ${meta.issue.trim()}`)
    if (meta.file) facts.push(`${words.file} ${meta.file.slice(meta.file.lastIndexOf('/') + 1)}`)
  }
  const status = input.statuses.find((config) => config.id === task.status)
  facts.push(status?.label ?? task.status)
  const priority = input.priorities.find((config) => config.id === task.priority)
  if (priority) facts.push(priority.label)
  const when = span(task.start, task.due)
  if (when) facts.push(when)
  const finished = isTerminalStatus(task.status, input.statuses)
  if (!finished && task.progress > 0) facts.push(`${task.progress} %`)
  if (task.assignees.length) facts.push(`@ ${task.assignees.join(', ')}`)
  // A dependency on a ticket nobody can find any more is left unsaid rather than named by
  // an identifier.
  const after = task.dependencies.map(nameOf).filter((name): name is string => !!name)
  if (after.length) facts.push(`${words.after} ${after.join(', ')}`)
  if (!finished && task.due && task.due < input.today) facts.push(words.late)
  return `${'  '.repeat(depth)}- ${task.title} · ${facts.join(' · ')}`
}

/**
 * The tickets as lines, in the project's tree. With `openOnly`, a finished ticket is left
 * out unless something still open sits under it: the tree keeps its shape, and the
 * finished leaves — history, most of the time — make room for the work still to do.
 */
function ticketLines(
  tasks: Task[],
  input: ProjectContextInput,
  words: ProjectWords,
  openOnly: boolean,
  nameOf: (id: string) => string | undefined
): { lines: string[]; skipped: number } {
  const lines: string[] = []
  let skipped = 0
  const open = (task: Task): boolean =>
    (!isPhase(task) && !isTerminalStatus(task.status, input.statuses)) || task.subtasks.some(open)
  const walk = (list: Task[], depth: number): void => {
    for (const task of list) {
      if (openOnly && !open(task)) {
        skipped += count(task)
        continue
      }
      lines.push(ticketLine(task, depth, input, words, nameOf))
      walk(task.subtasks, depth + 1)
    }
  }
  walk(tasks, 0)
  return { lines, skipped }
}

/** The tickets a ticket stands for, itself included; a lot counts only what it holds. */
function count(task: Task): number {
  return (isPhase(task) ? 0 : 1) + task.subtasks.reduce((sum, sub) => sum + count(sub), 0)
}

function flat(tasks: Task[]): Task[] {
  return tasks.flatMap((task) => [task, ...flat(task.subtasks)])
}

/**
 * The project as one block for the instructions.
 *
 * Every ticket when they all fit; the open ones, with the lots and parents that hold
 * them, when they do not — the model is told how many finished ones it was not shown —
 * and, past that, as many as fit, with the number of the rest. A model never answers
 * about a plan as if it had seen all of it when it has not.
 */
export function projectContext(input: ProjectContextInput, words: ProjectWords, budget = PROJECT_BUDGET): string {
  const all = input.parts.flatMap((part) => flat(part.tasks))
  const titles = new Map(all.map((task) => [task.id, task.title]))
  const nameOf = (id: string): string | undefined => titles.get(id) ?? input.titleOf?.(id)
  const figures = projectMetrics({
    tasks: all,
    statuses: input.statuses,
    priorities: input.priorities,
    today: input.today
  })

  const head = [`# ${input.title}${input.program ? ` (${words.program})` : ''}`]
  const description = input.description.trim()
  if (description) {
    const cut =
      description.length > DESCRIPTION_BUDGET ? `${description.slice(0, DESCRIPTION_BUDGET).trimEnd()}…` : description
    head.push(`${words.field.description} : ${cut}`)
  }
  if (input.team.length) head.push(`${words.field.team} : ${input.team.join(', ')}`)
  if (input.zones.length) head.push(`${words.field.zones} : ${input.zones.join(', ')}`)
  const when = span(figures.span.start, figures.span.due)
  if (when) head.push(`${words.field.span} : ${when}`)
  head.push(
    `${words.field.summary} : ${words.summary({
      total: figures.total,
      done: figures.done,
      progress: figures.progress,
      late: figures.late,
      soon: figures.dueSoon
    })}`
  )

  // A programme's projects each under their own name: a ticket belongs somewhere.
  const titled = input.parts.length > 1 || input.program
  const write = (openOnly: boolean): { lines: string[]; skipped: number } => {
    const lines: string[] = []
    let skipped = 0
    for (const part of input.parts) {
      const written = ticketLines(part.tasks, input, words, openOnly, nameOf)
      skipped += written.skipped
      if (titled) lines.push(`## ${part.title}`)
      lines.push(...written.lines)
    }
    return { lines, skipped }
  }
  const size = (lines: string[]): number => lines.reduce((sum, line) => sum + line.length + 1, 0)

  let written = write(false)
  let tail = ''
  if (size(written.lines) > budget) {
    written = write(true)
    if (written.skipped) tail = words.doneLeft(written.skipped)
  }
  if (size(written.lines) > budget) {
    const kept: string[] = []
    let used = 0
    for (const line of written.lines) {
      if (used + line.length + 1 > budget) break
      kept.push(line)
      used += line.length + 1
    }
    const shown = kept.filter((line) => line.startsWith('- ') || line.startsWith(' ')).length
    const listed = written.lines.filter((line) => line.startsWith('- ') || line.startsWith(' ')).length
    written = { lines: kept, skipped: written.skipped }
    tail = [tail, words.left(listed - shown)].filter(Boolean).join(' ')
  }

  const tickets = all.length ? written.lines.join('\n') : words.noTickets
  return [
    words.heading(input.title, input.path),
    `<project path="${input.path}">`,
    head.join('\n'),
    '',
    `${words.field.tickets} :`,
    tickets + (tail ? `\n\n${tail}` : ''),
    '</project>'
  ].join('\n')
}

/**
 * The projects a question about one of them is answered from: that one first, then the
 * ones under it, each with its tickets. A programme holds no tickets, so it is a part only
 * when it has some after all. Archived tickets are left out: filed away is done with, and
 * the archive is the reader's history rather than the plan.
 */
export function projectParts(primary: Project, projects: Project[]): ProjectPart[] {
  const current = (tasks: Task[]): Task[] =>
    tasks.filter((task) => !task.archived).map((task) => ({ ...task, subtasks: current(task.subtasks) }))
  return [primary, ...projects.filter((project) => project !== primary)]
    .filter((project) => !project.program || project.tasks.length > 0)
    .map((project) => ({ title: project.title, path: project.filePath, tasks: current(project.tasks) }))
}

/** The project the conversation's latest question was asked about, by its path. */
export function currentProject(turns: { role: string; project?: string }[]): string | undefined {
  for (let at = turns.length - 1; at >= 0; at--) {
    if (turns[at].role === 'user') return turns[at].project
  }
  return undefined
}
