import { describe, expect, it } from 'vitest'
import { checkPromptValues, reviewPromptValues } from '../../store/requirements/reqQualityLlm'
import { translationPromptValues } from '../../store/requirements/translate'
import { PROMPT_DEFS, promptDef, type PromptKey } from './promptDefs'
import { DEFAULT_REQUIREMENT_SETTINGS } from '../../types'

describe('the prompt definitions', () => {
  it('describes every instruction the settings hold', () => {
    const keys: PromptKey[] = ['reviewPrompt', 'checkPrompt', 'translatePrompt']
    expect(PROMPT_DEFS.map((def) => def.key).sort()).toEqual([...keys].sort())
    for (const key of keys) expect(DEFAULT_REQUIREMENT_SETTINGS[key]).toBe('')
  })

  /** What each prompt can actually substitute, from the functions that build it. */
  const valuesFor: Record<PromptKey, Record<string, string>> = {
    reviewPrompt: reviewPromptValues({ lang: 'fr', title: 'T', weak: [], score: 0.5, target: 0.8, count: 3 }),
    checkPrompt: checkPromptValues('fr'),
    translatePrompt: translationPromptValues('fr', 'en', { title: 'T', glossary: ['X'] })
  }

  // A placeholder listed on the page that the prompt cannot fill is a reader typing
  // something that silently does nothing.
  it('lists only placeholders the prompt can actually fill', () => {
    for (const def of PROMPT_DEFS) {
      for (const key of def.keys) expect(Object.keys(valuesFor[def.key])).toContain(key)
    }
  })

  // And the other way: one the shipped instruction uses but the page does not name is a
  // variable nobody knows they may keep.
  it('lists every placeholder the shipped instruction uses', () => {
    for (const def of PROMPT_DEFS) {
      for (const match of def.fallback.matchAll(/\{(\w+)\}/g)) expect(def.keys).toContain(match[1])
    }
  })

  it('ships a real instruction for each', () => {
    for (const def of PROMPT_DEFS) expect(def.fallback.trim().length).toBeGreaterThan(50)
  })

  it('finds one by key, and refuses a key it does not have', () => {
    expect(promptDef('checkPrompt').key).toBe('checkPrompt')
    expect(() => promptDef('nothing' as PromptKey)).toThrow('no prompt definition')
  })
})
