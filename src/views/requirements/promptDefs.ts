import { DEFAULT_CHECK_PROMPT, DEFAULT_REVIEW_PROMPT, REVIEW_PROMPT_KEYS } from '../../store/requirements/reqQualityLlm'
import { DEFAULT_TRANSLATION_PROMPT } from '../../store/requirements/translate'
import { t } from '../../i18n'

/**
 * The three instructions, described once.
 *
 * The settings pages and the button beside each action both need a name, a description,
 * the shipped text and the placeholders it may use. Two lists of those would answer the
 * same question differently within a release.
 *
 * The labels are functions rather than keys because the catalogue checker reads literal
 * `t('…')` calls: a key held in a variable is a key it reports as unused and a translator
 * never sees.
 */

export type PromptKey = 'reviewPrompt' | 'checkPrompt' | 'translatePrompt'

export interface PromptDef {
  key: PromptKey
  label: () => string
  desc: () => string
  /** The instruction this plugin ships, used when the reader has written none. */
  fallback: string
  keys: string[]
}

export const PROMPT_DEFS: PromptDef[] = [
  {
    key: 'reviewPrompt',
    label: () => t('settings.req.prompt'),
    desc: () => t('settings.req.promptDesc'),
    fallback: DEFAULT_REVIEW_PROMPT,
    keys: [...REVIEW_PROMPT_KEYS]
  },
  {
    key: 'checkPrompt',
    label: () => t('settings.req.checkPrompt'),
    desc: () => t('settings.req.checkPromptDesc'),
    fallback: DEFAULT_CHECK_PROMPT,
    keys: ['lang', 'rules']
  },
  {
    key: 'translatePrompt',
    label: () => t('settings.req.translatePrompt'),
    desc: () => t('settings.req.translatePromptDesc'),
    fallback: DEFAULT_TRANSLATION_PROMPT,
    keys: ['from', 'to', 'title', 'glossary']
  }
]

export function promptDef(key: PromptKey): PromptDef {
  const found = PROMPT_DEFS.find((def) => def.key === key)
  if (!found) throw new Error(`no prompt definition for ${key}`)
  return found
}
