import type { ChangeDecision, ChangeRoundNumber, TaskChange } from '../../types'
import type { BoardWords, ChangeStage } from '../../store/change'
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

/** The words a sitting of the board is written with. */
export function boardWords(): BoardWords {
  return {
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
    pending: t('change.board.pending')
  }
}
