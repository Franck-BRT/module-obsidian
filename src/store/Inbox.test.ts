import { describe, expect, it } from 'vitest'
import { affectsInbox, planInbox, planInboxFile } from './Inbox'

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

describe('affectsInbox', () => {
  const inbox = 'Projects/Toiture/_inbox'

  it('notices a file arriving in the inbox', () => {
    expect(affectsInbox(`${inbox}/Devis.msg`, inbox)).toBe(true)
  })

  it('notices the inbox folder itself appearing or going', () => {
    expect(affectsInbox(inbox, inbox)).toBe(true)
  })

  it('ignores a file elsewhere in the same project', () => {
    expect(affectsInbox('Projects/Toiture/_docs/Devis.pdf', inbox)).toBe(false)
    expect(affectsInbox('Projects/Toiture/_mail/Devis.msg', inbox)).toBe(false)
  })

  /** The one that bites: a sibling folder whose name starts with the inbox's. */
  it('ignores a folder that merely starts with the inbox name', () => {
    expect(affectsInbox('Projects/Toiture/_inbox-old/Devis.msg', inbox)).toBe(false)
  })

  it('ignores another project entirely', () => {
    expect(affectsInbox('Projects/Facade/_inbox/Devis.msg', inbox)).toBe(false)
  })
})
