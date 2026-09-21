import type { PMSettings, ReqPaletteConfig } from '../../types'
import type { ReqBlockField } from '../../store/requirements/reqBlockFields'
import { t } from '../../i18n'

/**
 * What a requirement's fields look like on screen.
 *
 * Every one of these is a reader-owned list, so a value that is no longer in the list is
 * shown as itself rather than dropped: a requirement whose status was deleted from the
 * settings still has that status, and hiding it would be the tool lying about the note.
 */

export interface ReqGlyph {
  label: string
  color: string
  icon: string
}

const UNKNOWN: ReqGlyph = { label: '', color: '#8b8c92', icon: 'circle-dashed' }

function lookup(list: ReqPaletteConfig[], id: string, fallbackIcon: string): ReqGlyph {
  if (!id) return UNKNOWN
  const found = list.find((entry) => entry.id === id)
  return found
    ? { label: found.label, color: found.color, icon: found.icon }
    : { label: id, color: UNKNOWN.color, icon: fallbackIcon }
}

export function reqTypeGlyph(settings: PMSettings, id: string): ReqGlyph {
  return lookup(settings.requirements.types, id, 'shapes')
}

export function reqStatusGlyph(settings: PMSettings, id: string): ReqGlyph {
  return lookup(settings.requirements.statuses, id, 'circle-dashed')
}

/**
 * How much a requirement matters, taken from the priorities palette rather than a second
 * one of its own: a vault that has already coloured Critical and High should not have to
 * colour them again to say the same thing about a requirement.
 */
export function reqCriticalityGlyph(settings: PMSettings, id: string): ReqGlyph {
  if (!id) return UNKNOWN
  const found = settings.priorities.find((entry) => entry.id === id)
  return found
    ? { label: found.label, color: found.color, icon: found.icon || 'flag' }
    : { label: id, color: UNKNOWN.color, icon: 'flag' }
}

export function verificationLabel(method: string): string {
  switch (method) {
    case 'test':
      return t('req.verification.test')
    case 'analysis':
      return t('req.verification.analysis')
    case 'inspection':
      return t('req.verification.inspection')
    case 'demonstration':
      return t('req.verification.demonstration')
    default:
      return t('req.verification.none')
  }
}

export function reqLinkKindLabel(kind: string): string {
  switch (kind) {
    case 'derives-from':
      return t('req.link.derivesFrom')
    case 'refines':
      return t('req.link.refines')
    case 'conflicts-with':
      return t('req.link.conflictsWith')
    case 'duplicates':
      return t('req.link.duplicates')
    default:
      return t('req.link.satisfiedBy')
  }
}

/**
 * A column of a `pm-req` block, named for a reader.
 *
 * Exhaustive rather than a lookup, so a column added to the vocabulary cannot reach the
 * settings page as its own identifier: the compiler asks for a name at the same time as
 * the feature.
 */
export function reqBlockFieldLabel(field: ReqBlockField): string {
  switch (field) {
    case 'id':
      return t('req.field.id')
    case 'title':
      return t('req.field.title')
    case 'text':
      return t('req.field.wording')
    case 'type':
      return t('req.field.type')
    case 'status':
      return t('req.field.status')
    case 'criticality':
      return t('req.field.criticality')
    case 'verification':
      return t('req.field.verification')
    case 'rating':
      return t('req.field.rating')
    case 'break':
      return t('req.field.break')
  }
}

/** The languages the library is kept in, never empty: a library with no language has no wording. */
export function reqLanguages(settings: PMSettings): string[] {
  const langs = settings.requirements.languages.map((lang) => lang.trim()).filter((lang) => lang !== '')
  return langs.length ? langs : ['fr']
}
