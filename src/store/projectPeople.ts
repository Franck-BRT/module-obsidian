import type { Task } from '../types'
import { displayName } from '../utils'
import type { Contact, ContactBook } from './contacts'
import { contactKey } from './contacts'
import { documentOf, isDocument } from './Document'
import { flattenTasks } from './TaskTreeOps'

/**
 * Who a project declares: its team, those its tickets are given to, and those its
 * documents come from or go to. Found in the people folder, a company brings the people
 * working for it along; a name no note stands for is kept as it is written.
 */
export interface ProjectPeople {
  /** The contacts of the people folder the project names, by their note's path. */
  contacts: Set<string>
  /** The names it writes that no contact stands for. */
  unknown: string[]
}

export function projectPeople(book: ContactBook, project: { teamMembers: string[]; tasks: Task[] }): ProjectPeople {
  const names: string[] = [...project.teamMembers]
  for (const { task } of flattenTasks(project.tasks)) {
    if (task.archived) continue
    names.push(...task.assignees)
    if (isDocument(task)) {
      const meta = documentOf(task)
      names.push(meta.issuer, meta.recipient)
    }
  }
  const contacts = new Set<string>()
  const unknown = new Map<string, string>()
  const add = (contact: Contact): void => {
    contacts.add(contact.path)
    if (contact.kind === 'company') for (const member of book.members(contact.name)) contacts.add(member.path)
  }
  for (const raw of names) {
    const key = contactKey(raw)
    if (!key) continue
    const contact = book.find(raw)
    if (contact) add(contact)
    else if (!unknown.has(key)) unknown.set(key, displayName(raw).trim())
  }
  return { contacts, unknown: [...unknown.values()].sort((a, b) => a.localeCompare(b)) }
}

/** How a contact is written on a delivery note: a person with the company they work for. */
export function contactLabel(contact: Pick<Contact, 'name' | 'kind' | 'company'>): string {
  return contact.kind === 'person' && contact.company ? `${contact.name} — ${contact.company}` : contact.name
}
