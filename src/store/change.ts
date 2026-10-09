import type { ChangeDecision, ChangeRound, ChangeRoundNumber, StatusConfig, Task, TaskChange } from '../types'
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

/** The changes a sitting of the board examines, by the round each waits for, by number within it. */
export function boardAgenda(tasks: Task[]): Record<ChangeRoundNumber, Task[]> {
  const agenda: Record<ChangeRoundNumber, Task[]> = { 0: [], 1: [], 2: [] }
  for (const task of tasks) {
    if (!isChange(task) || task.archived) continue
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
}

/** One sitting's decisions, as written for the record: by round, each change with what was decided. */
export interface BoardLine {
  task: Task
  round: ChangeRoundNumber
  decision: ChangeDecision | null
  comment: string
}

/** The note a sitting of the board is kept as: its agenda by round, each change with its decision. */
export function boardNote(date: string, lines: BoardLine[], words: BoardWords): string {
  const cell = (text: string): string =>
    text
      .replace(/\|/g, '/')
      .replace(/\s*\n\s*/g, ' ')
      .trim() || '—'
  const out = ['---', 'type: clm', `date: ${date}`, '---', '', `# ${words.title(date)}`, '']
  for (const round of CHANGE_ROUNDS) {
    const here = lines.filter((line) => line.round === round)
    out.push(`## ${words.round(round)}`, '', `*${words.roundHint(round)}*`, '')
    if (!here.length) {
      out.push(words.none, '')
      continue
    }
    out.push(
      `| ${words.number} | ${words.subject} | ${words.origin} | ${words.owner} | ${words.decision} | ${words.comment} |`,
      '| --- | --- | --- | --- | --- | --- |'
    )
    for (const line of here) {
      const change = changeOf(line.task)
      out.push(
        `| ${cell(change.number)} | ${cell(line.task.title)} | ${cell(displayName(change.origin))} | ${cell(changeOwner(line.task))} | ${line.decision ? words.decisionLabel(line.decision) : words.pending} | ${cell(line.comment)} |`
      )
    }
    out.push('')
  }
  return out.join('\n')
}
