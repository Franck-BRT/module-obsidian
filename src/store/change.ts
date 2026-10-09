import type {
  ChangeDecision,
  ChangeGroup,
  ChangeRound,
  ChangeRoundNumber,
  StatusConfig,
  Task,
  TaskChange
} from '../types'
import { DOCX_TEXT_WIDTH, para, type DocxBlock, type DocxCell, type DocxDocument } from './docx'
import { displayName } from '../utils'

/**
 * Configuration changes, as a project controls them: a Change Request — the DM, demande
 * de modification — says what should change and why; a Change Proposal — the PM,
 * proposition de modification — says how, and what it costs; the local change board —
 * the CLM, commission locale de modification — decides in three rounds:
 *
 * - round 0: the request is examined — is it worth a proposal?
 * - round 1: the proposal is examined — is it approved, to be carried out?
 * - round 2: what was carried out is checked — the change is closed.
 *
 * At each round the board accepts, refuses, postpones it to its next sitting, or sends
 * it back to be completed; the last two leave it waiting for the same round. A refusal
 * ends it. Who carries the proposal is the ticket's assignee; by when, its due date.
 */

export const CHANGE_ROUNDS: ChangeRoundNumber[] = [0, 1, 2]
export const CHANGE_DECISIONS: ChangeDecision[] = ['accepted', 'rejected', 'postponed', 'incomplete']
export const CHANGE_CLASSES: TaskChange['class'][] = ['major', 'minor']
export const CHANGE_GROUPS: ChangeGroup[] = [1, 2, 3]

/** Where a change stands, as its rounds put it. */
export type ChangeStage = 'draft' | 'round0' | 'round1' | 'round2' | 'closed' | 'rejected' | 'withdrawn'

export const CHANGE_STAGES: ChangeStage[] = ['draft', 'round0', 'round1', 'round2', 'closed', 'rejected', 'withdrawn']

export function isChange(task: Pick<Task, 'type'>): boolean {
  return task.type === 'change'
}

export function emptyChange(over: Partial<TaskChange> = {}): TaskChange {
  return {
    number: '',
    origin: '',
    class: 'minor',
    group: 0,
    reason: '',
    request: '',
    submittedOn: '',
    proposal: '',
    impactTechnical: '',
    impactCost: '',
    impactSchedule: '',
    affected: [],
    rounds: [],
    withdrawn: false,
    tasks: [],
    ...over
  }
}

export function changeOf(task: Pick<Task, 'change'>): TaskChange {
  return task.change ?? emptyChange()
}

/** The number the next change request takes: DM-001, DM-002…, past the highest there is. */
export function nextChangeNumber(tasks: Pick<Task, 'change'>[]): string {
  let highest = 0
  for (const task of tasks) {
    const found = /(\d+)\s*$/.exec(task.change?.number ?? '')
    if (found) highest = Math.max(highest, Number(found[1]))
  }
  return `DM-${String(highest + 1).padStart(3, '0')}`
}

/** The last decision taken at a round; none when the board has not sat on it. */
export function lastDecision(change: TaskChange, round?: ChangeRoundNumber): ChangeRound | undefined {
  const rounds = round === undefined ? change.rounds : change.rounds.filter((one) => one.round === round)
  return rounds[rounds.length - 1]
}

/**
 * Where it stands: written but not sent; waiting for round 0, 1 or 2; closed; refused;
 * withdrawn. Each round accepted opens the next; a refusal ends it; a round postponed
 * or sent back to be completed waits for the same round again.
 */
export function changeStage(change: TaskChange): ChangeStage {
  if (change.withdrawn) return 'withdrawn'
  if (change.rounds.some((round) => round.decision === 'rejected')) return 'rejected'
  if (lastDecision(change, 2)?.decision === 'accepted') return 'closed'
  if (lastDecision(change, 1)?.decision === 'accepted') return 'round2'
  if (lastDecision(change, 0)?.decision === 'accepted') return 'round1'
  return change.submittedOn ? 'round0' : 'draft'
}

/** The round it waits for; null when it waits for none — a draft, or a change ended. */
export function awaitedRound(change: TaskChange): ChangeRoundNumber | null {
  const stage = changeStage(change)
  return stage === 'round0' ? 0 : stage === 'round1' ? 1 : stage === 'round2' ? 2 : null
}

/** Whether it is over: closed, refused or withdrawn. */
export function isChangeOver(change: TaskChange): boolean {
  const stage = changeStage(change)
  return stage === 'closed' || stage === 'rejected' || stage === 'withdrawn'
}

/** The board's decision at a round added — the request sent with it, when it was not yet. */
export function recordDecision(
  change: TaskChange,
  round: ChangeRoundNumber,
  decision: ChangeDecision,
  date: string,
  comment = ''
): TaskChange {
  return {
    ...change,
    submittedOn: change.submittedOn || date,
    rounds: [...change.rounds, { round, decision, date, comment: comment.trim() }]
  }
}

/** The status a change's stage calls for: over, done; else the first open status. */
export function statusForChange(change: TaskChange, current: string, statuses: StatusConfig[]): string | null {
  const done = statuses.find((status) => status.complete && status.id === 'done') ?? statuses.find((s) => s.complete)
  const open = statuses.find((status) => !status.complete)
  const want = isChangeOver(change) ? done : open
  const now = statuses.find((status) => status.id === current)
  if (!want || want.id === current) return null
  // Still going, in some open status of the reader's: left there.
  if (!isChangeOver(change) && now && !now.complete) return null
  return want.id
}

/** Who carries the proposal, as the register names them; '' for nobody yet. */
export function changeOwner(task: Pick<Task, 'assignees'>): string {
  return task.assignees[0] ? displayName(task.assignees[0]) : ''
}

/** How many changes stand at each stage. */
export function changeCounts(tasks: Task[]): Record<ChangeStage, number> {
  const counts = Object.fromEntries(CHANGE_STAGES.map((stage) => [stage, 0])) as Record<ChangeStage, number>
  for (const task of tasks) if (isChange(task) && !task.archived) counts[changeStage(changeOf(task))] += 1
  return counts
}

/**
 * The changes a sitting of the board examines, by the round each waits for, by number
 * within it — those of one group only, when the sitting is for one.
 */
export function boardAgenda(tasks: Task[], group: ChangeGroup | null = null): Record<ChangeRoundNumber, Task[]> {
  const agenda: Record<ChangeRoundNumber, Task[]> = { 0: [], 1: [], 2: [] }
  for (const task of tasks) {
    if (!isChange(task) || task.archived) continue
    if (group !== null && changeOf(task).group !== group) continue
    const round = awaitedRound(changeOf(task))
    if (round !== null) agenda[round].push(task)
  }
  for (const round of CHANGE_ROUNDS) {
    agenda[round].sort((a, b) => changeOf(a).number.localeCompare(changeOf(b).number, undefined, { numeric: true }))
  }
  return agenda
}

/** The changes in the register's order: still going first, by number. */
export function orderChanges(tasks: Task[]): Task[] {
  return [...tasks].sort(
    (a, b) =>
      Number(isChangeOver(changeOf(a))) - Number(isChangeOver(changeOf(b))) ||
      changeOf(a).number.localeCompare(changeOf(b).number, undefined, { numeric: true }) ||
      a.title.localeCompare(b.title)
  )
}

export interface BoardWords {
  title: (date: string) => string
  round: (round: ChangeRoundNumber) => string
  roundHint: (round: ChangeRoundNumber) => string
  number: string
  subject: string
  origin: string
  owner: string
  decision: string
  comment: string
  decisionLabel: (decision: ChangeDecision) => string
  none: string
  pending: string
  group: string
  groupLabel: (group: ChangeGroup) => string
  /** What the sitting was, under its title: the project, and the group when it took one. */
  subtitle: (project: string, group: ChangeGroup | null) => string
  /** The decisions taken, counted: « 3 acceptées, 1 refusée ». */
  summary: (counts: Record<ChangeDecision, number>, pending: number) => string
  signatures: string
  chair: string
  secretary: string
  signHere: string
  /** A label and its value: « Porteur : Anne Leroy ». */
  field: (label: string, value: string) => string
}

/** One sitting's decisions, as written for the record: by round, each change with what was decided. */
export interface BoardLine {
  task: Task
  round: ChangeRoundNumber
  decision: ChangeDecision | null
  comment: string
}

/** The note a sitting of the board is kept as: its agenda by round, each change with its group and decision. */
export function boardNote(
  date: string,
  lines: BoardLine[],
  words: BoardWords,
  context: { project: string; group: ChangeGroup | null } = { project: '', group: null }
): string {
  const cell = (text: string): string =>
    text
      .replace(/\|/g, '/')
      .replace(/\s*\n\s*/g, ' ')
      .trim() || '—'
  const out = ['---', 'type: clm', `date: ${date}`]
  if (context.group) out.push(`group: ${context.group}`)
  out.push('---', '', `# ${words.title(date)}`, '')
  const subtitle = words.subtitle(context.project, context.group)
  if (subtitle) out.push(`*${subtitle}*`, '')
  for (const round of CHANGE_ROUNDS) {
    const here = lines.filter((line) => line.round === round)
    out.push(`## ${words.round(round)}`, '', `*${words.roundHint(round)}*`, '')
    if (!here.length) {
      out.push(words.none, '')
      continue
    }
    out.push(
      `| ${words.number} | ${words.subject} | ${words.group} | ${words.origin} | ${words.owner} | ${words.decision} | ${words.comment} |`,
      '| --- | --- | --- | --- | --- | --- | --- |'
    )
    for (const line of here) {
      const change = changeOf(line.task)
      out.push(
        `| ${cell(change.number)} | ${cell(line.task.title)} | ${change.group ? words.groupLabel(change.group) : '—'} | ${cell(displayName(change.origin))} | ${cell(changeOwner(line.task))} | ${line.decision ? words.decisionLabel(line.decision) : words.pending} | ${cell(line.comment)} |`
      )
    }
    out.push('')
  }
  out.push(boardSummary(lines, words), '')
  return out.join('\n')
}

/** The decisions of a sitting counted, those not examined apart. */
function boardSummary(lines: BoardLine[], words: BoardWords): string {
  const counts = Object.fromEntries(CHANGE_DECISIONS.map((decision) => [decision, 0])) as Record<ChangeDecision, number>
  let pending = 0
  for (const line of lines) {
    if (line.decision) counts[line.decision] += 1
    else pending += 1
  }
  return words.summary(counts, pending)
}

/**
 * The record of a sitting as a document — what Word and PDF are made from alike —: its
 * title and what it was, each round with its changes and the decisions taken, the
 * decisions counted, and the blocks the chair and the secretary sign.
 */
export function boardDocument(
  date: string,
  lines: BoardLine[],
  words: BoardWords,
  context: { project: string; group: ChangeGroup | null }
): DocxDocument {
  const cell = (text: string, width: number, bold = false): DocxCell => ({
    runs: [{ text: text || '—', ...(bold ? { bold: true } : {}) }],
    width
  })
  // Twentieths of a point: the subject takes what the others leave.
  const widths = [1150, 0, 1000, 1400, 1350, 2150]
  widths[1] = DOCX_TEXT_WIDTH - widths.reduce((sum, one) => sum + one, 0)
  const blocks: DocxBlock[] = [para('Title', words.title(date))]
  const subtitle = words.subtitle(context.project, context.group)
  if (subtitle) blocks.push(para('Meta', subtitle))
  for (const round of CHANGE_ROUNDS) {
    const here = lines.filter((line) => line.round === round)
    blocks.push(para('Heading1', words.round(round)), para('Meta', words.roundHint(round)))
    if (!here.length) {
      blocks.push(para('Normal', words.none))
      continue
    }
    blocks.push({
      kind: 'table',
      header: [words.number, words.subject, words.group, words.origin, words.decision, words.comment].map((text, at) =>
        cell(text, widths[at], true)
      ),
      rows: here.map((line) => {
        const change = changeOf(line.task)
        const owner = changeOwner(line.task)
        return [
          cell(change.number, widths[0]),
          cell(owner ? `${line.task.title}\n${words.field(words.owner, owner)}` : line.task.title, widths[1]),
          cell(change.group ? String(change.group) : '', widths[2]),
          cell(displayName(change.origin), widths[3]),
          cell(line.decision ? words.decisionLabel(line.decision) : words.pending, widths[4]),
          cell(line.comment, widths[5])
        ]
      })
    })
  }
  blocks.push(para('Normal', boardSummary(lines, words)), para('Heading1', words.signatures))
  const half = Math.floor(DOCX_TEXT_WIDTH / 2)
  const space = `${words.signHere}\n\n\n\n`
  blocks.push({
    kind: 'table',
    header: [cell(words.chair, half, true), cell(words.secretary, half, true)],
    rows: [[cell(space, half), cell(space, half)]]
  })
  return { title: words.title(date), blocks }
}
