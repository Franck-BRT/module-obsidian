import { describe, expect, it } from 'vitest'
import { planInbox, planInboxFile } from './Inbox'

describe('what the inbox does with a file', () => {
  it('sends a message one way and a deliverable the other', () => {
    expect(planInboxFile('Relance fournisseur.msg')).toBe('mail')
    expect(planInboxFile('Re: devis.eml')).toBe('mail')
    expect(planInboxFile('Plan de masse.pdf')).toBe('document')
    expect(planInboxFile('Métré.xlsx')).toBe('document')
    expect(planInboxFile('photo chantier.jpg')).toBe('document')
  })

  it('does not touch a markdown note, which may be a ticket the plugin wrote', () => {
    expect(planInboxFile('Une note.md')).toBe('skipped')
    expect(planInboxFile('TASK.MD')).toBe('skipped')
  })

  it('leaves a dotfile to whatever made it', () => {
    expect(planInboxFile('.DS_Store')).toBe('skipped')
    expect(planInboxFile('.gitkeep')).toBe('skipped')
  })

  it('ignores the case of an extension, as a file system does', () => {
    expect(planInboxFile('RELANCE.MSG')).toBe('mail')
    expect(planInboxFile('Plan.PDF')).toBe('document')
  })

  it('skips a name that is nothing at all', () => {
    expect(planInboxFile('   ')).toBe('skipped')
  })

  it('files a name with no extension as a document rather than losing it', () => {
    expect(planInboxFile('scan')).toBe('document')
  })

  it('plans a whole folder in one pass, keeping its order', () => {
    expect(planInbox(['a.msg', 'b.pdf', 'c.md'])).toEqual([
      { name: 'a.msg', kind: 'mail' },
      { name: 'b.pdf', kind: 'document' },
      { name: 'c.md', kind: 'skipped' }
    ])
  })
})
