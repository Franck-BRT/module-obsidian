import { describe, expect, it } from 'vitest'
import { attachmentCandidates, looksSaved, resolveAttachmentTarget, safeName, type TargetProbe } from './Attachments'

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
  const bytes = (...values: number[]): Uint8Array => new Uint8Array(values)
  const DEVIS = bytes(1, 2, 3)

  /** A folder, as the resolver sees it: what is at each path, if anything. */
  function folder(held: Record<string, Uint8Array>): TargetProbe & { reads: string[] } {
    const reads: string[] = []
    return {
      reads,
      sizeOf: (path) => held[path]?.length ?? null,
      bytesOf: (path) => {
        reads.push(path)
        return Promise.resolve(held[path] ?? null)
      }
    }
  }

  const candidates = (name = 'Devis.pdf'): string[] => attachmentCandidates('P/_docs', name, 5)

  it('names the candidates in order, suffix before the extension', () => {
    expect(candidates()).toEqual([
      'P/_docs/Devis.pdf',
      'P/_docs/Devis-1.pdf',
      'P/_docs/Devis-2.pdf',
      'P/_docs/Devis-3.pdf',
      'P/_docs/Devis-4.pdf'
    ])
  })

  it('cleans the name on the way in', () => {
    expect(candidates('a/b.pdf')[0]).toBe('P/_docs/a-b.pdf')
  })

  it('handles a name with no extension at all', () => {
    expect(candidates('scan')[1]).toBe('P/_docs/scan-1')
  })

  it('writes the file the first time', async () => {
    const target = await resolveAttachmentTarget(candidates(), DEVIS, folder({}))
    expect(target).toEqual({ path: 'P/_docs/Devis.pdf', exists: false })
  })

  /** The bug this rule exists for: clicking twice must not leave two copies. */
  it('finds the file it already wrote, rather than making a second copy', async () => {
    const target = await resolveAttachmentTarget(candidates(), DEVIS, folder({ 'P/_docs/Devis.pdf': DEVIS }))
    expect(target).toEqual({ path: 'P/_docs/Devis.pdf', exists: true })
  })

  /** Nothing is written down, so a file that is gone simply leaves its name free. */
  it('writes it again once the file has been deleted', async () => {
    const after = await resolveAttachmentTarget(candidates(), DEVIS, folder({}))
    expect(after).toEqual({ path: 'P/_docs/Devis.pdf', exists: false })
  })

  it('steps aside for a different file that happens to share the name', async () => {
    const held = { 'P/_docs/Devis.pdf': bytes(9, 9, 9, 9) }
    expect(await resolveAttachmentTarget(candidates(), DEVIS, folder(held))).toEqual({
      path: 'P/_docs/Devis-1.pdf',
      exists: false
    })
  })

  /** Same name, same length, different bytes: the hard case, and it must not open it. */
  it('is not fooled by a different file of exactly the same size', async () => {
    const held = { 'P/_docs/Devis.pdf': bytes(7, 7, 7) }
    expect(await resolveAttachmentTarget(candidates(), DEVIS, folder(held))).toEqual({
      path: 'P/_docs/Devis-1.pdf',
      exists: false
    })
  })

  it('finds its own copy past someone else’s', async () => {
    const held = { 'P/_docs/Devis.pdf': bytes(9, 9, 9, 9), 'P/_docs/Devis-1.pdf': DEVIS }
    expect(await resolveAttachmentTarget(candidates(), DEVIS, folder(held))).toEqual({
      path: 'P/_docs/Devis-1.pdf',
      exists: true
    })
  })

  it('reads only the candidates whose size already matched', async () => {
    const probe = folder({ 'P/_docs/Devis.pdf': bytes(9, 9, 9, 9), 'P/_docs/Devis-1.pdf': DEVIS })
    await resolveAttachmentTarget(candidates(), DEVIS, probe)
    expect(probe.reads).toEqual(['P/_docs/Devis-1.pdf'])
  })

  /** Losing the attachment would be worse than an ugly name. */
  it('still lands somewhere when every candidate is taken by something else', async () => {
    const held = Object.fromEntries(candidates().map((path) => [path, bytes(9, 9, 9, 9)]))
    const target = await resolveAttachmentTarget(candidates(), DEVIS, folder(held))
    expect(target.exists).toBe(false)
    expect(target.path).toMatch(/^P\/_docs\/Devis-\d+\.pdf$/)
    expect(held[target.path]).toBeUndefined()
  })
})

describe('whether a chip can say the file is already there', () => {
  const sizes = (held: Record<string, number>) => (path: string) => held[path] ?? null

  it('says so when a candidate is exactly that long', () => {
    expect(looksSaved(attachmentCandidates('P/_docs', 'Devis.pdf', 3), 284, sizes({ 'P/_docs/Devis.pdf': 284 }))).toBe(
      true
    )
  })

  it('says nothing when the folder is empty, or holds something else', () => {
    expect(looksSaved(attachmentCandidates('P/_docs', 'Devis.pdf', 3), 284, sizes({}))).toBe(false)
    expect(looksSaved(attachmentCandidates('P/_docs', 'Devis.pdf', 3), 284, sizes({ 'P/_docs/Devis.pdf': 12 }))).toBe(
      false
    )
  })
})
