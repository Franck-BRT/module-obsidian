import type { StatusConfig, Task } from '../types'
import { displayName, isTerminalStatus } from '../utils'
import { documentOf, isAwaited, isDocument } from './Document'
import type { ContactBook } from './contacts'
import { contactKey } from './contacts'
import { isPhase } from './Phase'
import { isRisk } from './risk'

/**
 * What each contact has to do with the projects: the tickets they are assigned, the
 * documents they owe — as their issuer —, and how much of either is late. And the names
 * the projects use that no contact answers to, to give them one.
 */

export interface WorkProject {
  path: string
  title: string
  tasks: Task[]
  statuses: StatusConfig[]
}

export interface WorkItem {
  task: Task
  project: WorkProject
  late: boolean
}

export interface ContactWork {
  /** Open tickets assigned to them, the latest first. */
  tickets: WorkItem[]
  /** Documents they owe, still expected, the latest first. */
  documents: WorkItem[]
  lateTickets: number
  lateDocuments: number
  /** The latest day a document they owe was chased; '' when never. */
  lastChase: string
  /** The projects they appear in, by path. */
  projects: Set<string>
}

export interface UnknownName {
  name: string
  /** Named as a document's issuer: a company, most likely. */
  issuer: boolean
  count: number
}

function empty(): ContactWork {
  return { tickets: [], documents: [], lateTickets: 0, lateDocuments: 0, lastChase: '', projects: new Set() }
}

const byDue = (a: WorkItem, b: WorkItem): number =>
  Number(b.late) - Number(a.late) || (a.task.due || '9999').localeCompare(b.task.due || '9999')

/** Each contact's work, by note path, and the names no contact answers to. */
export function contactWork(
  book: ContactBook,
  projects: WorkProject[],
  today: string
): { byContact: Map<string, ContactWork>; unknown: UnknownName[] } {
  const byContact = new Map<string, ContactWork>()
  const unknown = new Map<string, UnknownName>()
  const workOf = (path: string): ContactWork => {
    let work = byContact.get(path)
    if (!work) {
      work = empty()
      byContact.set(path, work)
    }
    return work
  }
  const missing = (raw: string, issuer: boolean): void => {
    const name = displayName(raw)
    const key = contactKey(name)
    if (!key) return
    const known = unknown.get(key) ?? { name, issuer: false, count: 0 }
    known.issuer ||= issuer
    known.count += 1
    unknown.set(key, known)
  }
  for (const project of projects) {
    for (const task of project.tasks) {
      if (task.archived || isPhase(task)) continue
      const done = isTerminalStatus(task.status, project.statuses)
      if (isDocument(task)) {
        const meta = documentOf(task)
        if (meta.issuer.trim()) {
          const contact = book.find(meta.issuer)
          if (!contact) missing(meta.issuer, true)
          else {
            const work = workOf(contact.path)
            work.projects.add(project.path)
            if (meta.state === 'expected') {
              const late = isAwaited(task, today)
              work.documents.push({ task, project, late })
              if (late) work.lateDocuments += 1
              const last = meta.chases?.[meta.chases.length - 1] ?? ''
              if (last > work.lastChase) work.lastChase = last
            }
          }
        }
      }
      for (const assignee of task.assignees) {
        const contact = book.find(assignee)
        if (!contact) {
          missing(assignee, false)
          continue
        }
        const work = workOf(contact.path)
        work.projects.add(project.path)
        if (done || isRisk(task)) continue
        const late = !!task.due && task.due < today
        work.tickets.push({ task, project, late })
        if (late) work.lateTickets += 1
      }
    }
  }
  for (const work of byContact.values()) {
    work.tickets.sort(byDue)
    work.documents.sort(byDue)
  }
  return {
    byContact,
    unknown: [...unknown.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
  }
}
