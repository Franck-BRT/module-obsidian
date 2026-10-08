import type { PersonaDraft } from '../../store/chat/personaLibrary'
import { t } from '../../i18n'

/** The personas the library offers to start from, in the reader's language. */
export function starterPersonas(): { name: string; draft: PersonaDraft }[] {
  const make = (name: string, category: string, description: string, instructions: string) => ({
    name,
    draft: { category, description, favorite: false, instructions }
  })
  return [
    make(
      t('persona.starter.site.name'),
      t('persona.starter.categorySite'),
      t('persona.starter.site.description'),
      t('persona.starter.site.instructions')
    ),
    make(
      t('persona.starter.inspector.name'),
      t('persona.starter.categorySite'),
      t('persona.starter.inspector.description'),
      t('persona.starter.inspector.instructions')
    ),
    make(
      t('persona.starter.procurement.name'),
      t('persona.starter.categoryLaw'),
      t('persona.starter.procurement.description'),
      t('persona.starter.procurement.instructions')
    ),
    make(
      t('persona.starter.minutes.name'),
      t('persona.starter.categoryWriting'),
      t('persona.starter.minutes.description'),
      t('persona.starter.minutes.instructions')
    ),
    make(
      t('persona.starter.translator.name'),
      t('persona.starter.categoryWriting'),
      t('persona.starter.translator.description'),
      t('persona.starter.translator.instructions')
    )
  ]
}
