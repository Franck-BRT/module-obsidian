import type { ImpactLevel, ProjectImpactRole } from '../../store/ZoneImpact'
import { IMPACT_LEVELS } from '../../types'
import { t } from '../../i18n'

/**
 * What each role is called and drawn as.
 *
 * Exhaustive switches rather than a lookup built from the list, so a fourth role cannot
 * be added without the compiler asking what it is called — and so the translation
 * checker can see the keys, which it cannot do through a key built at run time.
 */
export function impactRoleLabel(role: ProjectImpactRole): string {
  switch (role) {
    case 'both':
      return t('zone.role.both')
    case 'emitter':
      return t('zone.role.emitter')
    case 'receiver':
      return t('zone.role.receiver')
  }
}

export function impactRoleIcon(role: ProjectImpactRole): string {
  switch (role) {
    case 'both':
      return 'arrow-left-right'
    case 'emitter':
      return 'radio-tower'
    case 'receiver':
      return 'ear'
  }
}

/**
 * What each level is called, drawn as, and coloured by.
 *
 * Theme variables rather than fixed hues, because these are the reader's own error and
 * warning colours and a plugin that picks its own red is a plugin that looks wrong in
 * half the themes. Each carries an icon and a word as well, so the level survives being
 * read by someone who cannot tell the three apart by colour.
 */
export function impactLevelLabel(level: ImpactLevel): string {
  switch (level) {
    case 'blocking':
      return t('zone.level.blocking')
    case 'caution':
      return t('zone.level.caution')
    case 'info':
      return t('zone.level.info')
  }
}

export function impactLevelIcon(level: ImpactLevel): string {
  switch (level) {
    case 'blocking':
      return 'octagon-x'
    case 'caution':
      return 'triangle-alert'
    case 'info':
      return 'info'
  }
}

export function impactLevelColor(level: ImpactLevel): string {
  switch (level) {
    case 'blocking':
      return 'var(--text-error, var(--color-red))'
    case 'caution':
      return 'var(--text-warning, var(--color-orange))'
    case 'info':
      return 'var(--text-muted)'
  }
}

/** The three levels as a picker offers them, glyph and colour included. */
export function impactLevelOptions(): { id: ImpactLevel; label: string; icon: string; color: string }[] {
  return IMPACT_LEVELS.map((level) => ({
    id: level,
    label: impactLevelLabel(level),
    icon: impactLevelIcon(level),
    color: impactLevelColor(level)
  }))
}
