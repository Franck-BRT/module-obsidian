import type { PMSettings } from '../../types'
import type { Requirement } from '../../store/requirements/Requirement'
import type { ReqBlockField } from '../../store/requirements/reqBlockFields'
import { assessRequirement } from '../../store/requirements/reqScore'
import {
  reqCriticalityGlyph,
  reqLanguages,
  reqStatusGlyph,
  reqTypeGlyph,
  verificationLabel,
  type ReqGlyph
} from './reqPalette'

/**
 * The head line of a quoted requirement, decided before anything is drawn.
 *
 * Separated from the drawing because the order is the part that can be wrong, and the
 * drawing is the part that cannot be tested: `createSpan` needs a document this project's
 * tests do not have. Held apart, the decision is a list anyone can read back — and the
 * bug this file exists because of, an identifier drawn ahead of the loop and so always
 * first whatever the settings said, is one assertion away instead of one screenshot away.
 */

export type ReqHeadPart =
  | { kind: 'id'; id: string }
  | { kind: 'title'; text: string }
  | { kind: 'chip'; glyph: ReqGlyph }
  | { kind: 'rating'; stars: number; score: number }

/**
 * What the head shows, one line at a time, in the order it was asked for.
 *
 * Nothing empty is kept: a requirement with no status must not leave a blank chip behind,
 * because a row of empty outlines reads as a requirement with something missing rather
 * than as a document that asked for a column this requirement has nothing to put in.
 *
 * `text` is not a column — it is a paragraph under the head — so it is dropped here
 * rather than turned into a part nobody would know how to draw on one line.
 *
 * A line break starts the next line, and a line that ended up with nothing on it is not
 * returned at all: two breaks in a row, or one at either end, are somebody dragging
 * things about, not somebody asking for a blank line in a specification.
 */
export function reqHeadLines(requirement: Requirement, fields: ReqBlockField[], settings: PMSettings): ReqHeadPart[][] {
  const lines: ReqHeadPart[][] = []
  let parts: ReqHeadPart[] = []
  const chip = (glyph: ReqGlyph): void => {
    if (glyph.label) parts.push({ kind: 'chip', glyph })
  }
  for (const field of fields) {
    switch (field) {
      case 'id':
        parts.push({ kind: 'id', id: requirement.id })
        break
      case 'title':
        if (requirement.title) parts.push({ kind: 'title', text: requirement.title })
        break
      case 'type':
        chip(reqTypeGlyph(settings, requirement.type))
        break
      case 'status':
        chip(reqStatusGlyph(settings, requirement.status))
        break
      case 'criticality':
        chip(reqCriticalityGlyph(settings, requirement.criticality))
        break
      case 'verification':
        if (requirement.verification !== 'none') {
          chip({ label: verificationLabel(requirement.verification), color: '', icon: 'check-check' })
        }
        break
      case 'rating': {
        const report = assessRequirement(requirement, reqLanguages(settings))
        parts.push({ kind: 'rating', stars: report.stars, score: Math.round(report.score * 100) })
        break
      }
      case 'text':
        break
      case 'break':
        if (parts.length) lines.push(parts)
        parts = []
        break
    }
  }
  if (parts.length) lines.push(parts)
  return lines
}
