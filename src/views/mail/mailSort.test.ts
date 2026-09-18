import { describe, expect, it } from 'vitest'
import type { MailEntry } from '../../store/MailBox'
import { matchesQuery } from '../../store/MailBox'
import { orderMail } from './mailSort'

const entry = (name: string, over: Partial<MailEntry['mail']> = {}): MailEntry => ({
  path: `Projects/P/_mail/${name}`,
  name,
  mail: { subject: '', from: '', to: [], cc: [], date: '', body: '', attachments: [], ...over }
})

const unreadable = (name: string): MailEntry => ({ path: `Projects/P/_mail/${name}`, name, mail: null })

const names = (entries: MailEntry[]): string[] => entries.map((e) => e.name)

describe('the order a mailbox is read in', () => {
  const box = [
    entry('b.msg', { date: '2026-04-02', from: 'Zoé', subject: 'Devis' }),
    entry('a.msg', { date: '2026-04-09', from: 'Alain', subject: 'Planning' }),
    entry('c.msg', { date: '2026-03-30', from: 'Marc', subject: 'Compte rendu' })
  ]

  it('puts the newest first by default', () => {
    expect(names(orderMail(box, { sortKey: 'date', sortDir: 'desc' }))).toEqual(['a.msg', 'b.msg', 'c.msg'])
  })

  it('reads by sender and by subject too', () => {
    expect(names(orderMail(box, { sortKey: 'from', sortDir: 'asc' }))).toEqual(['a.msg', 'c.msg', 'b.msg'])
    expect(names(orderMail(box, { sortKey: 'subject', sortDir: 'asc' }))).toEqual(['c.msg', 'b.msg', 'a.msg'])
  })

  /**
   * A message with no readable date is not the oldest message in the box: it is one
   * whose date nobody knows. Reversing the order must not parade those at the top.
   */
  it('sends an unknown field last, whichever way round the list is read', () => {
    const mixed = [entry('dated.msg', { date: '2026-04-02' }), unreadable('mystery.msg')]
    expect(names(orderMail(mixed, { sortKey: 'date', sortDir: 'asc' }))).toEqual(['dated.msg', 'mystery.msg'])
    expect(names(orderMail(mixed, { sortKey: 'date', sortDir: 'desc' }))).toEqual(['dated.msg', 'mystery.msg'])
  })

  it('breaks a tie on the file name, so the list does not shuffle itself', () => {
    const sameDay = [
      entry('z.msg', { date: '2026-04-02', from: 'Marc' }),
      entry('a.msg', { date: '2026-04-02', from: 'Marc' })
    ]
    expect(names(orderMail(sameDay, { sortKey: 'date', sortDir: 'desc' }))).toEqual(['a.msg', 'z.msg'])
  })

  it('names an unreadable message by its file, so it keeps its place in the box', () => {
    const box2 = [unreadable('broken.msg'), entry('other.msg', { subject: 'Aaa' })]
    expect(names(orderMail(box2, { sortKey: 'subject', sortDir: 'asc' }))).toEqual(['other.msg', 'broken.msg'])
  })

  it('leaves the given list alone', () => {
    const before = names(box)
    orderMail(box, { sortKey: 'from', sortDir: 'asc' })
    expect(names(box)).toEqual(before)
  })
})

describe('looking for a message', () => {
  const mail = entry('devis.msg', {
    subject: 'Devis toiture',
    from: 'Marie Lefèvre <m.lefevre@bati.fr>',
    body: 'Le délai est de trois semaines.'
  })

  it('looks in the sender, the subject and the text', () => {
    expect(matchesQuery(mail, 'lefèvre')).toBe(true)
    expect(matchesQuery(mail, 'toiture')).toBe(true)
    expect(matchesQuery(mail, 'trois semaines')).toBe(true)
  })

  it('ignores case, and an empty search matches everything', () => {
    expect(matchesQuery(mail, 'DEVIS')).toBe(true)
    expect(matchesQuery(mail, '   ')).toBe(true)
  })

  /** An unreadable message has only its file name to be found by; it must still be findable. */
  it('finds a message that could not be read, by its file name', () => {
    expect(matchesQuery(unreadable('relance-fournisseur.msg'), 'relance')).toBe(true)
    expect(matchesQuery(unreadable('relance.msg'), 'devis')).toBe(false)
  })

  it('says no when nothing holds the words', () => {
    expect(matchesQuery(mail, 'plomberie')).toBe(false)
  })
})
