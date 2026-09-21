import { describe, expect, it } from 'vitest'
import { checkWording, needsReview, worstSeverity, type QualityRule } from './reqQuality'

const rules = (body: string, lang = 'fr'): QualityRule[] => checkWording(body, lang).map((finding) => finding.rule)

describe('checkWording, in French', () => {
  const good = 'Le système doit ouvrir la trappe en moins de 3 s.'

  it('has nothing to say about a well-written requirement', () => {
    expect(checkWording(good, 'fr')).toEqual([])
  })

  it('says nothing at all about an empty wording, which is a different problem', () => {
    expect(checkWording('   ', 'fr')).toEqual([])
  })

  it('catches a sentence that obliges nobody to anything', () => {
    expect(rules('Le système ouvre la trappe rapidement.')).toContain('no-modal')
  })

  // Two obligations under one identifier cannot be accepted, rejected or traced
  // separately, which is the whole reason an identifier exists.
  it('catches two obligations wearing one identifier', () => {
    expect(rules('Le système doit ouvrir la trappe et doit journaliser 3 événements.')).toContain('multiple')
  })

  it('catches a term nobody can verify, through its agreement', () => {
    const found = checkWording('Le système doit répondre de manière appropriée en 3 s.', 'fr')
    expect(found.map((f) => f.rule)).toContain('weak-word')
    expect(found.find((f) => f.rule === 'weak-word')?.term).toBe('approprié')
  })

  it('does not find a vague word inside an innocent one', () => {
    // "environ" lives inside "environnement", and a checker that cried about that would
    // be switched off within a day.
    expect(rules("Le système doit surveiller l'environnement pendant 3 h.")).toEqual([])
  })

  it('catches an obligation with nobody to carry it', () => {
    expect(rules('Les données doivent être chiffrées avant 3 h.')).toContain('passive-no-actor')
  })

  it('accepts the same sentence once it says who', () => {
    expect(rules('Les données doivent être chiffrées par le module cryptographique avant 3 h.')).not.toContain(
      'passive-no-actor'
    )
  })

  it('catches a comparison with nothing to compare against', () => {
    expect(rules('Le système doit être plus rapide que la version précédente.')).toContain('unquantified')
  })

  it('accepts a comparison that carries a figure', () => {
    expect(rules('Le système doit répondre en moins de 3 s.')).not.toContain('unquantified')
  })

  it('catches a decision nobody has taken', () => {
    expect(rules('Le système doit tenir une charge de TBD kg.')).toContain('tbd')
  })

  it('catches an alternative nobody can test', () => {
    expect(rules('Le système doit alerter par courriel et/ou par SMS sous 3 min.')).toContain('and-or')
  })

  it('catches a sentence that has become a paragraph', () => {
    const long = `Le système doit ${'traiter chaque événement entrant '.repeat(12)}en 3 s.`
    expect(rules(long)).toContain('too-long')
  })
})

describe('checkWording, in English', () => {
  it('has nothing to say about a well-written requirement', () => {
    expect(checkWording('The system shall open the hatch in under 3 s.', 'en')).toEqual([])
  })

  it('catches the same defects in its own vocabulary', () => {
    expect(rules('The system opens the hatch quickly.', 'en')).toContain('no-modal')
    expect(rules('The response shall be adequate within 3 s.', 'en')).toContain('weak-word')
    expect(rules('The data shall be encrypted before 3 h.', 'en')).toContain('passive-no-actor')
    expect(rules('The data shall be encrypted by the crypto module before 3 h.', 'en')).not.toContain(
      'passive-no-actor'
    )
  })
})

describe('a language the tool has no lexicon for', () => {
  // Finding nothing and so declaring the sentence clean is worse than saying less.
  it('is spared the checks that are about vocabulary', () => {
    expect(rules('Das System öffnet die Klappe.', 'de')).not.toContain('no-modal')
  })

  it('still gets the checks that are about markers rather than vocabulary', () => {
    expect(rules('Das System muss TBD kg tragen.', 'de')).toContain('tbd')
    expect(rules('Alarm per E-Mail and/or SMS.', 'de')).toContain('and-or')
  })

  // Recorded rather than hidden: the marker check knows the markers it knows, and a
  // German "und/oder" is a gap in the lexicons, not a rule that fired and found nothing.
  it('does not pretend to know a marker written in a language it has no lexicon for', () => {
    expect(rules('Alarm per E-Mail und/oder SMS.', 'de')).not.toContain('and-or')
  })
})

describe('worstSeverity', () => {
  it('reports the gravest of what was found', () => {
    expect(worstSeverity(checkWording('Le système ouvre la trappe.', 'fr'))).toBe('error')
    expect(worstSeverity(checkWording('Le système doit alerter par courriel et/ou par SMS.', 'fr'))).toBe('warning')
    expect(worstSeverity([])).toBeNull()
  })
})

describe('needsReview', () => {
  it('answers the question the library asks of every wording at once', () => {
    expect(needsReview('Le système doit ouvrir la trappe en 3 s.', 'fr')).toBe(false)
    expect(needsReview('Le système ouvre la trappe.', 'fr')).toBe(true)
  })
})
