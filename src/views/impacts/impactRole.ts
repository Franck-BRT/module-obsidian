import type { ProjectImpactRole } from '../../store/ZoneImpact'
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
