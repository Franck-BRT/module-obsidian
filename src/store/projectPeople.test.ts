import { describe, expect, it } from 'vitest'
import { makeDocument, makeTask } from '../types'
import { ContactBook, readContact } from './contacts'
import { contactLabel, projectPeople } from './projectPeople'

const contact = (name: string, fm: Record<string, unknown>) => readContact(`People/${name}.md`, name, fm)

const BOOK = new ContactBook([
  contact('Socotec', { kind: 'company' }),
  contact('Jeanne Martin', { company: 'Socotec' }),
  contact('Paul Durand', { company: 'Eiffage' }),
  contact('Anne Leroy', {}),
  contact('Luc Petit', {})
])

describe('the people a project declares', () => {
  const project = {
    teamMembers: ['[[Anne Leroy]]'],
    tasks: [
      makeTask({
        title: 'Lot 1',
        type: 'phase',
        subtasks: [
          makeTask({ title: 'Coffrage', assignees: ['Paul Durand'] }),
          makeTask({
            title: 'Plan',
            type: 'document',
            document: makeDocument({ recipient: 'Socotec', issuer: 'BET Structure' })
          })
        ]
      }),
      makeTask({ title: 'Ancien', assignees: ['Luc Petit'], archived: true })
    ]
  }
  const people = projectPeople(BOOK, project)

  it('takes its team, its assignees, its documents’ issuers and recipients, and a company’s people', () => {
    expect([...people.contacts].sort()).toEqual([
      'People/Anne Leroy.md',
      'People/Jeanne Martin.md',
      'People/Paul Durand.md',
      'People/Socotec.md'
    ])
  })

  it('keeps the names no note stands for', () => {
    expect(people.unknown).toEqual(['BET Structure'])
  })
})

describe('a contact as a delivery note writes it', () => {
  it('names a person with their company', () => {
    expect(contactLabel(contact('Jeanne Martin', { company: 'Socotec' }))).toBe('Jeanne Martin — Socotec')
    expect(contactLabel(contact('Socotec', { kind: 'company' }))).toBe('Socotec')
    expect(contactLabel(contact('Anne Leroy', {}))).toBe('Anne Leroy')
  })
})
