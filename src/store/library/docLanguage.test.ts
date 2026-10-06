import { describe, expect, it } from 'vitest'
import { detectLanguage } from './docLanguage'

describe('detectLanguage', () => {
  it('tells the languages of the library apart by their small words', () => {
    expect(
      detectLanguage(
        "Le système doit être livré avant la fin de l'année. Les essais de type sont réalisés sur un modèle de qualification, avec les moyens du site et dans les conditions définies par le plan."
      )
    ).toBe('fr')
    expect(
      detectLanguage(
        'The system shall be delivered before the end of the year. The type tests are performed on a qualification model, with the means of the site and in the conditions defined by the plan.'
      )
    ).toBe('en')
    expect(
      detectLanguage(
        'Das System wird vor dem Ende des Jahres geliefert. Die Typprüfungen werden an einem Qualifikationsmodell mit den Mitteln der Anlage und unter den Bedingungen durchgeführt, die der Plan nicht ändert und die auch für den Betrieb gelten.'
      )
    ).toBe('de')
    expect(
      detectLanguage(
        'El sistema debe ser entregado antes del final del año. Los ensayos de tipo se realizan sobre un modelo de calificación, con los medios del sitio y en las condiciones definidas por el plan para su uso.'
      )
    ).toBe('es')
    expect(
      detectLanguage(
        "Il sistema deve essere consegnato prima della fine dell'anno. Le prove di tipo sono eseguite su un modello di qualifica, con i mezzi del sito e nelle condizioni definite dal piano per il suo uso, che non cambia."
      )
    ).toBe('it')
  })

  it('does not guess at a text too short, or with no words of these languages', () => {
    expect(detectLanguage('Plan RDC indice B')).toBe('')
    expect(detectLanguage('12 345 678 — 3.2.1 / 4.5')).toBe('')
  })
})
