import { getLanguage } from 'obsidian'
import { en } from './en'
import { fr } from './fr'

export type TranslationKey = keyof typeof en
/** A count-sensitive entry. `one` covers whatever the locale treats as singular. */
export interface PluralForms {
  one: string
  other: string
}
export type Catalog = Partial<Record<TranslationKey, string | PluralForms>>

export const LOCALES = ['en', 'fr'] as const
export type Locale = (typeof LOCALES)[number]
export type LanguageSetting = 'auto' | Locale

const CATALOGS: Record<Locale, Catalog> = { en, fr }

/**
 * English counts 1 as singular; French counts 0 and 1. Getting this wrong reads as a
 * bug to a native speaker ("0 tâches"), so it is per-locale rather than shared.
 */
const IS_SINGULAR: Record<Locale, (n: number) => boolean> = {
  en: (n) => n === 1,
  fr: (n) => n > -2 && n < 2
}

let locale: Locale = 'en'

/** Obsidian's own UI language when the setting is 'auto', falling back to English. */
export function resolveLocale(setting: LanguageSetting): Locale {
  if (setting !== 'auto') return setting
  const app = getLanguage()
  return LOCALES.find((l) => l === app) ?? 'en'
}

export function setLocale(setting: LanguageSetting): void {
  locale = resolveLocale(setting)
}

export function currentLocale(): Locale {
  return locale
}

/**
 * The translated string for `key`, with `{name}` placeholders filled from `vars`.
 * Entries carrying `one`/`other` pick their form from `vars.count`.
 *
 * A key the active locale has not translated falls back to English rather than
 * showing the key, so merging new strings from upstream degrades to English instead
 * of breaking the interface. `i18n.test.ts` fails when French falls behind.
 */
export function t(key: TranslationKey, vars?: Record<string, string | number>): string {
  const entry = CATALOGS[locale][key] ?? en[key]
  const raw =
    typeof entry === 'string' ? entry : IS_SINGULAR[locale](Number(vars?.count ?? 0)) ? entry.one : entry.other
  if (!vars) return raw
  return raw.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const value = vars[name]
    return value === undefined ? whole : String(value)
  })
}
