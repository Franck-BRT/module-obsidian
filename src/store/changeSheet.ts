import type { ChangeDecision, ChangeGroup, ChangeRoundNumber, Task, TaskChange } from '../types'
import { CHANGE_ROUNDS, changeOf, changeOwner, type ChangeStage, changeStage } from './change'
import { affectedLabel } from './decision'
import { DOCX_TEXT_WIDTH, para, type DocxBlock, type DocxCell, type DocxDocument } from './docx'
import { displayName } from '../utils'

/** The words a change's sheet is written with, in the reader's language. */
export interface ChangeSheetWords {
  title: (number: string) => string
  identification: string
  number: string
  subject: string
  class: string
  classLabel: (kind: TaskChange['class']) => string
  group: string
  groupLabel: (group: ChangeGroup) => string
  origin: string
  owner: string
  due: string
  submittedOn: string
  stage: string
  stageLabel: (stage: ChangeStage) => string
  requestHeading: string
  reason: string
  request: string
  affected: string
  proposalHeading: string
  proposal: string
  impactTechnical: string
  impactCost: string
  impactSchedule: string
  roundsHeading: string
  roundColumn: string
  round: (round: ChangeRoundNumber) => string
  date: string
  decision: string
  comment: string
  decisionLabel: (decision: ChangeDecision) => string
  noRound: string
  tasksHeading: string
  taskStatus: string
  signatures: string
  /** Who signs the sheet: who asks, who carries the proposal, who chairs the board. */
  signers: [string, string, string]
  signHere: string
  /** What an empty field reads as. */
  none: string
  formatDate: (date: string) => string
}

/** One ticket carrying a change out, as the sheet lists it. */
export interface SheetTask {
  title: string
  status: string
  due: string
}

/**
 * A change's sheet — the form that goes round for signature, in Word and in PDF alike —:
 * who asks for what and why, what it touches, the proposal and what it costs, each round
 * of the board with its decision, the tickets carrying it out, and the boxes to sign.
 */
export function changeSheetDocument(
  task: Pick<Task, 'title' | 'change' | 'assignees' | 'due'>,
  words: ChangeSheetWords,
  context: { project: string; tasks?: SheetTask[] }
): DocxDocument {
  const change = changeOf(task)
  const cell = (text: string, width: number, bold = false): DocxCell => ({
    runs: [{ text: text.trim() ? text : words.none, ...(bold ? { bold: true } : {}) }],
    width
  })
  const label = 2600
  const value = DOCX_TEXT_WIDTH - label
  const fields = (rows: [string, string][]): DocxBlock => ({
    kind: 'table',
    header: [cell(rows[0][0], label, true), cell(rows[0][1], value)],
    rows: rows.slice(1).map(([name, text]) => [cell(name, label, true), cell(text, value)])
  })
  const text = (heading: string, body: string): DocxBlock[] => [
    para('Heading2', heading),
    ...(body.trim() ? body.trim().split(/\n\s*\n/) : [words.none]).map((one) => para('Normal', one.trim()))
  ]

  // The three impacts side by side: what it does to the design, the cost, the schedule.
  const impacts = (): DocxBlock => {
    const third = Math.floor(DOCX_TEXT_WIDTH / 3)
    return {
      kind: 'table',
      header: [words.impactTechnical, words.impactCost, words.impactSchedule].map((one) => cell(one, third, true)),
      rows: [[change.impactTechnical, change.impactCost, change.impactSchedule].map((one) => cell(one, third))]
    }
  }

  const title = words.title(change.number || words.none)
  const blocks: DocxBlock[] = [para('Title', title)]
  if (context.project) blocks.push(para('Meta', context.project))

  blocks.push(
    para('Heading1', words.identification),
    fields([
      [words.number, change.number],
      [words.subject, task.title],
      [words.class, words.classLabel(change.class)],
      [words.group, change.group ? words.groupLabel(change.group) : ''],
      [words.origin, displayName(change.origin)],
      [words.owner, changeOwner(task)],
      [words.due, task.due ? words.formatDate(task.due) : ''],
      [words.submittedOn, change.submittedOn ? words.formatDate(change.submittedOn) : ''],
      [words.stage, words.stageLabel(changeStage(change))]
    ])
  )

  blocks.push(
    para('Heading1', words.requestHeading),
    ...text(words.reason, change.reason),
    ...text(words.request, change.request),
    para('Heading2', words.affected)
  )
  if (change.affected.length) {
    for (const one of change.affected) blocks.push(para('Bullet', affectedLabel(one)))
  } else blocks.push(para('Normal', words.none))

  blocks.push(para('Heading1', words.proposalHeading), ...text(words.proposal, change.proposal), impacts())

  blocks.push(para('Heading1', words.roundsHeading))
  if (change.rounds.length) {
    const widths = [2000, 1500, 1700, 0]
    widths[3] = DOCX_TEXT_WIDTH - widths.reduce((sum, one) => sum + one, 0)
    const ordered = CHANGE_ROUNDS.flatMap((round) => change.rounds.filter((one) => one.round === round))
    blocks.push({
      kind: 'table',
      header: [words.roundColumn, words.date, words.decision, words.comment].map((one, at) =>
        cell(one, widths[at], true)
      ),
      rows: ordered.map((one) => [
        cell(words.round(one.round), widths[0]),
        cell(one.date ? words.formatDate(one.date) : '', widths[1]),
        cell(words.decisionLabel(one.decision), widths[2]),
        cell(one.comment, widths[3])
      ])
    })
  } else blocks.push(para('Normal', words.noRound))

  if (context.tasks?.length) {
    const widths = [0, 2200, 1700]
    widths[0] = DOCX_TEXT_WIDTH - widths[1] - widths[2]
    blocks.push(para('Heading1', words.tasksHeading), {
      kind: 'table',
      header: [words.subject, words.taskStatus, words.due].map((one, at) => cell(one, widths[at], true)),
      rows: context.tasks.map((one) => [
        cell(one.title, widths[0]),
        cell(one.status, widths[1]),
        cell(one.due ? words.formatDate(one.due) : '', widths[2])
      ])
    })
  }

  const third = Math.floor(DOCX_TEXT_WIDTH / 3)
  const space = `${words.signHere}\n\n\n\n`
  blocks.push(para('Heading1', words.signatures), {
    kind: 'table',
    header: words.signers.map((one) => cell(one, third, true)),
    rows: [words.signers.map(() => cell(space, third))]
  })
  return { title, blocks }
}
