import type { ChangeGroup, Task } from '../types'
import { awaitedRound, changeOf, changeStage, CHANGE_GROUPS, isChange, lastDecision } from './change'

/**
 * What follows a change once the board has spoken: the tickets that carry out an approved
 * proposal, the documents a closed change makes to be issued again, and what a project's
 * changes come to on its dashboard.
 */

/**
 * The tickets an approved proposal is carried out by, as first offered: the lines of the
 * proposal written as a list, each one; when it has none, one ticket named after the change.
 */
export function implementationLines(task: Pick<Task, 'title' | 'change'>): string[] {
  const change = changeOf(task)
  const listed = change.proposal
    .split('\n')
    .map((line) => /^\s*(?:[-*•]|\d+[.)])\s+(.+)$/.exec(line)?.[1].trim() ?? '')
    .filter(Boolean)
  if (listed.length) return listed
  return [[change.number, task.title].filter(Boolean).join(' — ')]
}

/**
 * The next issue of a document: the number at its end one up, its zeros kept — « 02 » to
 * « 03 », « 2-15 » to « 2-16 » —, else its last letter one on — « A » to « B », « Z » to
 * « AA » —; what is given when it has none yet.
 */
export function nextIssue(value: string, first = 'A'): string {
  const text = value.trim()
  if (!text) return first
  const digits = /^(.*?)(\d+)$/.exec(text)
  if (digits) {
    const next = String(Number(digits[2]) + 1).padStart(digits[2].length, '0')
    return `${digits[1]}${next}`
  }
  const letters = /^(.*?)([A-Za-z]+)$/.exec(text)
  if (!letters) return `${text}1`
  const chars = [...letters[2]]
  let at = chars.length - 1
  while (at >= 0) {
    const char = chars[at]
    if (char === 'Z' || char === 'z') {
      chars[at] = char === 'Z' ? 'A' : 'a'
      at -= 1
      continue
    }
    chars[at] = String.fromCharCode(char.charCodeAt(0) + 1)
    break
  }
  if (at < 0) chars.unshift(letters[2][0] === letters[2][0].toLowerCase() ? 'a' : 'A')
  return `${letters[1]}${chars.join('')}`
}

/** Whether a decision just taken approved the proposal: the change was waiting for round 1, and now for round 2. */
export function approvesProposal(before: Pick<Task, 'change'>, after: Pick<Task, 'change'>): boolean {
  return changeStage(changeOf(before)) === 'round1' && changeStage(changeOf(after)) === 'round2'
}

/** Whether a decision just taken closed the change: it was waiting for round 2, and is now closed. */
export function closesChange(before: Pick<Task, 'change'>, after: Pick<Task, 'change'>): boolean {
  return changeStage(changeOf(before)) === 'round2' && changeStage(changeOf(after)) === 'closed'
}

/** A change waiting too long for its proposal: its request accepted that many days ago. */
export interface StaleChange {
  task: Task
  days: number
}

/** What a project's changes come to, for its dashboard. */
export interface ChangeDigest {
  /** Changes still going. */
  open: number
  /** What the next sitting of the board has to examine, by group — 0 for none —, the groups in order. */
  nextBoard: { group: ChangeGroup; count: number }[]
  /** The changes waiting for the next sitting, every group together. */
  toExamine: number
  /** Requests accepted at round 0 whose proposal has not come before the board after so many days, the oldest first. */
  stale: StaleChange[]
  /** Changes closed this month. */
  closedThisMonth: number
}

/** Whole days from one date to another, both YYYY-MM-DD. */
function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)
}

/** A project's changes in figures: what the next sitting takes by group, the proposals overdue, the month's closures. */
export function changeDigest(tasks: Task[], today: string, staleAfter = 30): ChangeDigest {
  const changes = tasks.filter((task) => isChange(task) && !task.archived)
  const byGroup = new Map<ChangeGroup, number>()
  const stale: StaleChange[] = []
  let open = 0
  let closedThisMonth = 0
  for (const task of changes) {
    const change = changeOf(task)
    const stage = changeStage(change)
    if (stage === 'closed') {
      const closed = lastDecision(change, 2)?.date ?? ''
      if (closed.slice(0, 7) === today.slice(0, 7)) closedThisMonth += 1
      continue
    }
    if (stage === 'rejected' || stage === 'withdrawn') continue
    open += 1
    if (awaitedRound(change) !== null) byGroup.set(change.group, (byGroup.get(change.group) ?? 0) + 1)
    if (stage === 'round1') {
      const since = lastDecision(change, 0)?.date ?? ''
      const days = since ? daysBetween(since, today) : 0
      if (days >= staleAfter) stale.push({ task, days })
    }
  }
  const nextBoard = ([...CHANGE_GROUPS, 0] as ChangeGroup[])
    .map((group) => ({ group, count: byGroup.get(group) ?? 0 }))
    .filter((one) => one.count)
  return {
    open,
    nextBoard,
    toExamine: nextBoard.reduce((sum, one) => sum + one.count, 0),
    stale: stale.sort((a, b) => b.days - a.days),
    closedThisMonth
  }
}
