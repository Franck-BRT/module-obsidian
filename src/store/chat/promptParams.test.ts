import { describe, expect, it } from 'vitest'
import { fillPrompt, promptParams } from './promptParams'

describe('promptParams', () => {
  it('reads each blank: its label and what it takes', () => {
    expect(
      promptParams(
        'Compte rendu de {Personne:personne} depuis le {Depuis le:date}, en {Langue:langue}, par {Critère:coût| délai |qualité}, sur {Sujet}.'
      )
    ).toEqual([
      { raw: 'Personne:personne', label: 'Personne', kind: 'person', choices: [] },
      { raw: 'Depuis le:date', label: 'Depuis le', kind: 'date', choices: [] },
      { raw: 'Langue:langue', label: 'Langue', kind: 'language', choices: [] },
      { raw: 'Critère:coût| délai |qualité', label: 'Critère', kind: 'choice', choices: ['coût', 'délai', 'qualité'] },
      { raw: 'Sujet', label: 'Sujet', kind: 'text', choices: [] }
    ])
  })

  it('takes the English words, a list with no label, and asks for a blank used twice once', () => {
    expect(promptParams('{Since:date} … {Who:person} … {a|b} … {Since:date}')).toEqual([
      { raw: 'Since:date', label: 'Since', kind: 'date', choices: [] },
      { raw: 'Who:person', label: 'Who', kind: 'person', choices: [] },
      { raw: 'a|b', label: '', kind: 'choice', choices: ['a', 'b'] }
    ])
  })

  it('drops the empty entries of a list', () => {
    expect(promptParams('{Critère:coût||délai|}')[0]?.choices).toEqual(['coût', 'délai'])
  })

  // Today and the projects are known: nothing to ask.
  it('does not ask for what it already knows', () => {
    expect(promptParams("Point du {aujourd'hui} sur {projet}, au {Today}.")).toEqual([])
    expect(promptParams('Sans blanc.')).toEqual([])
  })
})

describe('fillPrompt', () => {
  const known = { today: '2026-09-28', projects: 'Génie civil, Équipements' }

  it('fills the blanks asked for and the ones known', () => {
    expect(
      fillPrompt(
        "Compte rendu {projet} depuis le {Depuis le:date} jusqu'au {aujourd’hui}, pour {Personne:personne}.",
        { 'Depuis le:date': '2026-09-14', 'Personne:personne': ' Anne ' },
        known
      )
    ).toBe("Compte rendu Génie civil, Équipements depuis le 2026-09-14 jusqu'au 2026-09-28, pour Anne.")
  })

  // A blank with nothing to put in stays, where the reader sees it.
  it('leaves a blank with no value as it was', () => {
    expect(fillPrompt('Tâches de {Personne:personne} sur {projet}.', {}, { today: '2026-09-28', projects: '' })).toBe(
      'Tâches de {Personne:personne} sur {projet}.'
    )
  })
})
