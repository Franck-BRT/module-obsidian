import { describe, expect, it } from 'vitest'
import { freeAttachmentPath, safeName } from './Attachments'

describe('a file name the vault will accept', () => {
  it('leaves an ordinary name alone', () => {
    expect(safeName('Devis toiture.pdf')).toBe('Devis toiture.pdf')
    expect(safeName('Réception n°4.pdf')).toBe('Réception n°4.pdf')
  })

  /** The one that matters: a separator inside a name writes the file somewhere else. */
  it('cannot be talked into writing outside the folder', () => {
    expect(safeName('rapport 1/2.pdf')).toBe('rapport 1-2.pdf')
    expect(safeName('../../secret.pdf')).toBe('secret.pdf')
    expect(safeName('a\\b.pdf')).toBe('a-b.pdf')
  })

  it('replaces what a file system refuses, rather than dropping it', () => {
    expect(safeName('note: urgent?.pdf')).toBe('note- urgent-.pdf')
    expect(safeName('a*b"c<d>e|f.pdf')).toBe('a-b-c-d-e-f.pdf')
  })

  it('never returns a hidden file, or no name at all', () => {
    expect(safeName('.hidden.pdf')).toBe('hidden.pdf')
    expect(safeName('   ')).toBe('attachment')
    expect(safeName('...')).toBe('attachment')
  })
})

describe('where an attachment lands', () => {
  const nothingTaken = (): boolean => false

  it('uses the name it was given when nothing holds it', () => {
    expect(freeAttachmentPath('P/_docs', 'Devis.pdf', nothingTaken)).toBe('P/_docs/Devis.pdf')
  })

  /** Saving the same attachment from two messages must not overwrite the first. */
  it('steps aside rather than landing on what is already there', () => {
    const taken = new Set(['P/_docs/Devis.pdf', 'P/_docs/Devis-1.pdf'])
    expect(freeAttachmentPath('P/_docs', 'Devis.pdf', (path) => taken.has(path))).toBe('P/_docs/Devis-2.pdf')
  })

  /** `Devis.pdf-1` is not a PDF as far as anything else in the vault is concerned. */
  it('puts the suffix before the extension, where it belongs', () => {
    const taken = new Set(['P/_docs/plan.dwg'])
    expect(freeAttachmentPath('P/_docs', 'plan.dwg', (path) => taken.has(path))).toBe('P/_docs/plan-1.dwg')
  })

  it('handles a name with no extension at all', () => {
    const taken = new Set(['P/_docs/scan'])
    expect(freeAttachmentPath('P/_docs', 'scan', (path) => taken.has(path))).toBe('P/_docs/scan-1')
  })

  it('cleans the name on the way in', () => {
    expect(freeAttachmentPath('P/_docs', 'a/b.pdf', nothingTaken)).toBe('P/_docs/a-b.pdf')
  })
})
