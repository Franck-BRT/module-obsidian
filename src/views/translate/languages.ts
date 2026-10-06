import type PMPlugin from '../../main'
import { languageName } from '../../store/requirements/translate'
import { reqLanguages } from '../requirements/reqPalette'
import { t } from '../../i18n'

/** The languages offered: the common ones, then those the requirements are written in. */
export function languages(plugin: PMPlugin): string[] {
  return [
    ...new Set([
      'fr',
      'en',
      'de',
      'es',
      'it',
      'pt',
      'nl',
      'pl',
      'ru',
      'sv',
      'ja',
      'zh',
      ...reqLanguages(plugin.settings)
    ])
  ]
}

/** A language's name for the reader. */
export function languageLabel(code: string): string {
  switch (code.trim().toLowerCase().split(/[-_]/)[0]) {
    case 'fr':
      return t('translate.lang.fr')
    case 'en':
      return t('translate.lang.en')
    case 'de':
      return t('translate.lang.de')
    case 'es':
      return t('translate.lang.es')
    case 'it':
      return t('translate.lang.it')
    case 'pt':
      return t('translate.lang.pt')
    case 'nl':
      return t('translate.lang.nl')
    case 'pl':
      return t('translate.lang.pl')
    case 'ru':
      return t('translate.lang.ru')
    case 'sv':
      return t('translate.lang.sv')
    case 'ja':
      return t('translate.lang.ja')
    case 'zh':
      return t('translate.lang.zh')
    default:
      return languageName(code)
  }
}
