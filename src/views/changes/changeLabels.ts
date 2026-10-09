import type { ChangeDecision, ChangeGroup, ChangeRoundNumber, TaskChange } from '../../types'
import { CHANGE_DECISIONS, type BoardWords, type ChangeStage } from '../../store/change'
import type { ChangeSheetWords } from '../../store/changeSheet'
import { formatDate } from '../../dates'
import { t } from '../../i18n'

export function stageLabel(stage: ChangeStage): string {
  switch (stage) {
    case 'draft':
      return t('change.stage.draft')
    case 'round0':
      return t('change.stage.round0')
    case 'round1':
      return t('change.stage.round1')
    case 'round2':
      return t('change.stage.round2')
    case 'closed':
      return t('change.stage.closed')
    case 'rejected':
      return t('change.stage.rejected')
    case 'withdrawn':
      return t('change.stage.withdrawn')
  }
}

export const STAGE_ICON: Record<ChangeStage, string> = {
  draft: 'pencil',
  round0: 'circle-dot',
  round1: 'circle-dot-dashed',
  round2: 'hammer',
  closed: 'circle-check',
  rejected: 'circle-x',
  withdrawn: 'undo-2'
}

export function decisionLabel(decision: ChangeDecision): string {
  switch (decision) {
    case 'accepted':
      return t('change.decision.accepted')
    case 'rejected':
      return t('change.decision.rejected')
    case 'postponed':
      return t('change.decision.postponed')
    case 'incomplete':
      return t('change.decision.incomplete')
  }
}

export function roundLabel(round: ChangeRoundNumber): string {
  return round === 0 ? t('change.round.0') : round === 1 ? t('change.round.1') : t('change.round.2')
}

export function roundHint(round: ChangeRoundNumber): string {
  return round === 0 ? t('change.round.0.hint') : round === 1 ? t('change.round.1.hint') : t('change.round.2.hint')
}

export function classLabel(kind: TaskChange['class']): string {
  return kind === 'major' ? t('change.class.major') : t('change.class.minor')
}

export function groupLabel(group: ChangeGroup): string {
  return group ? t('change.group.n', { group }) : t('change.group.none')
}

/** « Porteur : Anne Leroy » — a label and its value, as each language writes them. */
function field(label: string, value: string): string {
  return t('change.board.field', { label, value })
}

/** The words a sitting of the board is written with. */
export function boardWords(): BoardWords {
  return {
    field,
    title: (date) => t('change.board.noteTitle', { date: formatDate(date) }),
    round: roundLabel,
    roundHint,
    number: t('change.number'),
    subject: t('change.subject'),
    origin: t('change.origin'),
    owner: t('change.owner'),
    decision: t('change.decisionColumn'),
    comment: t('change.comment'),
    decisionLabel,
    none: t('change.board.noneAtRound'),
    pending: t('change.board.pending'),
    group: t('change.group'),
    groupLabel,
    subtitle: (project, group) =>
      [project, group ? groupLabel(group) : t('change.board.allGroups')].filter(Boolean).join(' · '),
    summary: (counts, pending) => {
      const parts = CHANGE_DECISIONS.filter((decision) => counts[decision]).map((decision) =>
        field(decisionLabel(decision), String(counts[decision]))
      )
      if (pending) parts.push(field(t('change.board.pending'), String(pending)))
      return `${t('change.board.summary')} ${parts.join(' · ') || '—'}`
    },
    signatures: t('change.board.signatures'),
    chair: t('change.board.chair'),
    secretary: t('change.board.secretary'),
    signHere: t('change.board.signHere')
  }
}

/** The words a change's sheet is written with. */
export function sheetWords(): ChangeSheetWords {
  return {
    title: (number) => t('change.sheet.title', { number }),
    identification: t('change.sheet.identification'),
    number: t('change.number'),
    subject: t('change.subject'),
    class: t('change.class'),
    classLabel,
    group: t('change.group'),
    groupLabel,
    origin: t('change.origin'),
    owner: t('change.owner'),
    due: t('change.sheet.due'),
    submittedOn: t('change.submittedOn'),
    stage: t('change.stageColumn'),
    stageLabel,
    requestHeading: t('change.section.request'),
    reason: t('change.reason'),
    request: t('change.request'),
    affected: t('change.affected'),
    proposalHeading: t('change.section.proposal'),
    proposal: t('change.proposal'),
    impactTechnical: t('change.impactTechnical'),
    impactCost: t('change.impactCost'),
    impactSchedule: t('change.impactSchedule'),
    roundsHeading: t('change.section.board'),
    roundColumn: t('change.sheet.round'),
    round: roundLabel,
    date: t('change.sheet.date'),
    decision: t('change.decisionColumn'),
    comment: t('change.comment'),
    decisionLabel,
    noRound: t('change.sheet.noRound'),
    tasksHeading: t('change.tasks.title'),
    taskStatus: t('change.sheet.status'),
    signatures: t('change.board.signatures'),
    signers: [t('change.sheet.signOrigin'), t('change.sheet.signOwner'), t('change.board.chair')],
    signHere: t('change.board.signHere'),
    none: '—',
    formatDate
  }
}
