import { describe, expect, it } from 'vitest'
import { asksForDeadlines, deadlinesBlock, findDates, findDelays } from './deadlines'

const OS = `ORDRE DE SERVICE N° 3
Le présent ordre de service est notifié le 14/10/2026.
La réunion de lancement aura lieu le 21 octobre 2026 à 10 h en salle B12.
Les travaux démarreront le 2 novembre 2026 ; le PAQ sera remis sous 15 jours à compter de la notification.
Réception prévisionnelle : 30.06.2027. Levée des réserves au plus tard le 1er septembre.
Planning : 2026-11-16 | Ferraillage radier`

describe('the dates a document sets', () => {
  it('are found however written, in order, each with its sentence', () => {
    const found = findDates(OS, 2026)
    expect(found.map((one) => one.date)).toEqual([
      '2026-10-14',
      '2026-10-21',
      '2026-11-02',
      '2027-06-30',
      '2026-09-01',
      '2026-11-16'
    ])
    expect(found[1]).toMatchObject({
      written: '21 octobre 2026',
      sentence: 'La réunion de lancement aura lieu le 21 octobre 2026 à 10 h en salle B12.',
      guessedYear: false
    })
    expect(found[3].written).toBe('30.06.2027')
  })

  it('gives a date in a table its whole row, and a dotted date its own sentence', () => {
    const table =
      '| N° | Action | Responsable | Échéance |\n| 1 | Transmettre la note de calcul | Garonne Bâtiment | 05/11/2026 |'
    expect(findDates(table, 2026)[0].sentence).toBe('1 | Transmettre la note de calcul | Garonne Bâtiment | 05/11/2026')
    const dotted =
      'Les plans seront visés au plus tard le 06/11/2026. La réception est fixée au 30.06.2027 ; la levée suit.'
    expect(findDates(dotted, 2026)[1].sentence).toBe('La réception est fixée au 30.06.2027 ;')
  })

  it('takes the year the document writes most for a day and month written alone, and says so', () => {
    const levee = findDates(OS, 2030).find((one) => one.written.startsWith('1er'))
    expect(levee).toMatchObject({ date: '2026-09-01', guessedYear: true })
    expect(findDates('Rendu le 5 mars.', 2031)[0]).toMatchObject({ date: '2031-03-05', guessedYear: true })
  })

  it('leaves out what is no date: a version, a reference, an impossible day', () => {
    expect(findDates('Version 2.3.1 — réf. 12/34/2026 — le 31/02/2026 — 1.5.10', 2026)).toEqual([])
    expect(findDates('Sous 15 jours, 3 semaines, 12 mois.', 2026)).toEqual([])
  })

  it('reads English dates too', () => {
    expect(findDates('Kick-off on October 21, 2026, review by 12 November 2026.', 2026).map((one) => one.date)).toEqual(
      ['2026-10-21', '2026-11-12']
    )
  })
})

describe('the delays a document sets', () => {
  it('are found with what they run from', () => {
    const delays = findDelays(OS)
    expect(delays).toHaveLength(1)
    expect(delays[0].written).toBe('sous 15 jours à compter de la notification')
    expect(findDelays('Plans soumis dans un délai de 4 semaines avant le ferraillage.')[0].written).toBe(
      'dans un délai de 4 semaines avant le ferraillage'
    )
  })
})

describe('the dates as the model is given them', () => {
  it('lists each file’s dates and delays, a year guessed said so', () => {
    const block = deadlinesBlock([{ name: 'OS 3.pdf', text: OS }], {
      intro: 'Dates relevées :',
      file: (name) => name,
      guessed: 'année supposée',
      delays: 'Délais relatifs :',
      none: '(aucune)'
    })
    expect(block).toContain('### OS 3.pdf')
    expect(block).toContain('- 2026-10-21 — « 21 octobre 2026 » — La réunion de lancement')
    expect(block).toContain('(année supposée)')
    expect(block).toContain('Délais relatifs :\n- « sous 15 jours à compter de la notification »')
  })

  it('is asked for by the words of deadlines, in either language', () => {
    expect(asksForDeadlines('Relève les échéances de ce document')).toBe(true)
    expect(asksForDeadlines('What are the key dates?')).toBe(true)
    expect(asksForDeadlines('Résume ce document')).toBe(false)
  })
})
