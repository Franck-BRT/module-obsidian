import type { PptxDeck, PptxLine, PptxSlide } from '../pptx'
import type { Requirement } from './Requirement'
import { textOf } from './Requirement'
import { namesOf } from './reqAlias'

/**
 * The library as a deck for a review.
 *
 * A requirements review is walked one requirement at a time, in a room, with the words on
 * the wall — so one slide per requirement, and the slide holds what the room argues
 * about: the statement itself, large, and underneath it the two things that decide
 * whether the argument is finished, which are how it will be verified and why it exists.
 *
 * Everything else a table would carry is on one line at the bottom. A slide is not a
 * spreadsheet, and a reviewer reading columns is a reviewer not listening.
 */

export interface PptxWords {
  /** The deck's first slide. */
  title: string
  subtitle: (count: number) => string
  /** A field as the reader sees it, and the word that introduces it. */
  glyph: (requirement: Requirement, field: 'type' | 'status' | 'criticality' | 'verification') => string
  rating: (requirement: Requirement) => string
  rationale: string
  source: string
  noWording: string
  noCategory: string
  /** What a section slide says above the category's name. */
  section: string
}

function statement(requirement: Requirement, lang: string, words: PptxWords): PptxLine[] {
  const held = textOf(requirement, lang) ?? textOf(requirement, requirement.sourceLang)
  const lines: PptxLine[] = [{ text: held ? held.body : words.noWording }]
  // Quiet, under the statement: a review that cannot see why a requirement exists spends
  // its time rediscovering it.
  if (requirement.rationale) lines.push({ text: `${words.rationale} : ${requirement.rationale}`, quiet: true })
  if (requirement.source) lines.push({ text: `${words.source} : ${requirement.source}`, quiet: true })
  return lines
}

/** The line along the bottom: what a reviewer needs at a glance and nothing else. */
function footer(requirement: Requirement, words: PptxWords): string {
  return [
    words.glyph(requirement, 'status'),
    words.glyph(requirement, 'type'),
    words.glyph(requirement, 'criticality'),
    words.glyph(requirement, 'verification'),
    words.rating(requirement)
  ]
    .filter((bit) => bit !== '')
    .join('  ·  ')
}

export function requirementSlide(requirement: Requirement, lang: string, words: PptxWords): PptxSlide {
  const other = namesOf(requirement).slice(1)
  return {
    // The identifier above the title, where the eye goes first in a room: it is what
    // somebody will say out loud to object.
    eyebrow: other.length ? `${requirement.id}  ·  ${other.join('  ·  ')}` : requirement.id,
    title: requirement.title || requirement.id,
    body: statement(requirement, lang, words),
    footer: footer(requirement, words)
  }
}

/**
 * The deck: a cover, then each category announced before the requirements under it.
 *
 * Grouped the way the library is grouped, because a reviewer who has just been shown
 * where they are reads the next six slides differently from one who has not.
 */
export function libraryDeck(requirements: Requirement[], lang: string, words: PptxWords): PptxDeck {
  const slides: PptxSlide[] = [
    { title: words.title, body: [{ text: words.subtitle(requirements.length), quiet: true }] }
  ]
  let category = '\u0000'
  for (const requirement of requirements) {
    if (requirement.category !== category) {
      category = requirement.category
      slides.push({ eyebrow: words.section, title: category || words.noCategory, body: [] })
    }
    slides.push(requirementSlide(requirement, lang, words))
  }
  return { title: words.title, slides }
}
