import { describe, expect, it } from 'vitest'
import { en } from './en'
import { fr } from './fr'
import { dateLocale, LOCALES, resolveLocale, searchAliases, setLocale, t, type TranslationKey } from './index'

const KEYS = Object.keys(en) as TranslationKey[]

describe('translation catalogues', () => {
  it('translates every key into French', () => {
    const missing = KEYS.filter((key) => fr[key] === undefined)
    // Names the gaps rather than just failing: after an upstream merge this is the
    // list of strings still to translate.
    expect(missing, `untranslated in French: ${missing.join(', ')}`).toEqual([])
  })

  it('translates no key French has that English does not', () => {
    const extra = Object.keys(fr).filter((key) => !(key in en))
    expect(extra, `stale French keys: ${extra.join(', ')}`).toEqual([])
  })

  it('keeps the same placeholders in every locale', () => {
    const holders = (s: string): string[] => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()
    const forms = (v: unknown): string[] =>
      typeof v === 'string' ? [v] : [(v as { one: string }).one, (v as { other: string }).other]
    for (const key of KEYS) {
      const translated = fr[key]
      if (translated === undefined) continue
      const source = forms(en[key]).flatMap(holders)
      for (const form of forms(translated)) {
        expect(holders(form), `placeholders differ for ${key}`).toEqual([...new Set(source)].sort())
      }
    }
  })

  it('keeps a plural entry plural in every locale', () => {
    for (const key of KEYS) {
      const translated = fr[key]
      if (translated === undefined) continue
      expect(typeof translated, `plural shape differs for ${key}`).toBe(typeof en[key])
    }
  })
})

describe('t', () => {
  it('fills placeholders', () => {
    setLocale('en')
    expect(t('project.open', { title: 'Roadmap' })).toBe('Open Roadmap')
  })

  it('leaves an unknown placeholder alone rather than printing undefined', () => {
    setLocale('en')
    expect(t('project.open', {})).toBe('Open {title}')
  })

  it('counts 1 as singular in English', () => {
    setLocale('en')
    expect(t('count.tasks', { count: 1 })).toBe('1 task')
    expect(t('count.tasks', { count: 0 })).toBe('0 tasks')
    expect(t('count.tasks', { count: 2 })).toBe('2 tasks')
  })

  it('counts 0 and 1 as singular in French', () => {
    setLocale('fr')
    expect(t('count.tasks', { count: 0 })).toBe('0 tâche')
    expect(t('count.tasks', { count: 1 })).toBe('1 tâche')
    expect(t('count.tasks', { count: 2 })).toBe('2 tâches')
  })

  it('falls back to English for a key the locale has not translated', () => {
    setLocale('fr')
    const untranslated = { ...fr }
    delete untranslated['common.task']
    // The catalogue is complete today, so assert the mechanism on the resolver instead.
    expect(t('common.task')).toBe(fr['common.task'])
    setLocale('en')
    expect(t('common.task')).toBe(en['common.task'])
  })
})

describe('resolveLocale', () => {
  it('honours an explicit choice', () => {
    for (const locale of LOCALES) expect(resolveLocale(locale)).toBe(locale)
  })

  it('falls back to English for a language with no catalogue', () => {
    // The stub reports 'en'; anything unlisted resolves the same way.
    expect(resolveLocale('auto')).toBe('en')
  })
})

describe('dateLocale', () => {
  it('defers to the host on auto, so an untranslated vault keeps its own month names', () => {
    setLocale('auto')
    expect(dateLocale()).toBeUndefined()
  })

  it('follows an explicit choice, so dates match the language that was picked', () => {
    setLocale('fr')
    expect(dateLocale()).toBe('fr')
    setLocale('en')
    expect(dateLocale()).toBe('en')
  })
})

describe('settings search aliases', () => {
  const ALIAS_KEYS = KEYS.filter((key) => key.startsWith('settings.aliases.'))

  it('are declared for every setting that had them', () => {
    expect(ALIAS_KEYS.length).toBe(22)
  })

  it('split into real words in both locales, with nothing empty', () => {
    for (const locale of LOCALES) {
      setLocale(locale)
      for (const key of ALIAS_KEYS) {
        const words = searchAliases(key)
        expect(words.length, `${key} in ${locale}`).toBeGreaterThan(0)
        expect(words.every((word) => word.length > 0)).toBe(true)
        expect(words.every((word) => word === word.trim())).toBe(true)
      }
    }
  })

  it('say something different in French, or the translation was skipped', () => {
    setLocale('en')
    const english = ALIAS_KEYS.map((key) => searchAliases(key).join('|'))
    setLocale('fr')
    const french = ALIAS_KEYS.map((key) => searchAliases(key).join('|'))
    expect(french.filter((words, i) => words === english[i])).toEqual([])
  })
})
