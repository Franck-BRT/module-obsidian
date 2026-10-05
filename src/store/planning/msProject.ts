import type { DependencyType } from '../../types'
import { childLocal, childrenLocal, parseXml, type XmlNode } from '../xmlParse'
import type { Plan, PlanLine, PlanLink, PlanWarning } from './plan'

/**
 * Reading a planning saved by MS Project as XML (« Enregistrer sous → Format XML », the
 * MSPDI format): its tasks in outline order, their dates, their progress, the resources
 * assigned to them and their links. The `.mpp` file itself is a closed binary format;
 * MS Project, ProjectLibre and GanttProject all save this XML.
 */

export class MsProjectError extends Error {}

/** MS Project's link types: 0 finish-to-finish, 1 finish-to-start, 2 start-to-finish, 3 start-to-start. */
const LINK_TYPES: Record<string, DependencyType> = { '0': 'FF', '1': 'FS', '2': 'SF', '3': 'SS' }

const text = (node: XmlNode | null, name: string): string => childLocal(node, name)?.text.trim() ?? ''

/** A lag as days: stored in tenths of minutes, a working day being 8 hours, an elapsed one 24. */
function lagDays(link: XmlNode): number {
  const tenths = Number(text(link, 'LinkLag')) || 0
  const format = text(link, 'LagFormat')
  // 4, 6, 8, 10, 12 are the elapsed units (minutes, hours, days, weeks, months).
  const elapsed = ['4', '6', '8', '10', '12', '36', '38', '40', '42', '44'].includes(format)
  return Math.round(tenths / (elapsed ? 14_400 : 4_800))
}

export function readMsProject(source: string): Plan {
  let root: XmlNode
  try {
    root = parseXml(source.charCodeAt(0) === 0xfeff ? source.slice(1) : source)
  } catch (error) {
    throw new MsProjectError(error instanceof Error ? error.message : String(error))
  }
  if (root.name.replace(/^.*:/, '') !== 'Project') throw new MsProjectError('Not an MS Project XML file.')
  const warnings: PlanWarning[] = []
  const resources = new Map<string, string>()
  for (const resource of childrenLocal(childLocal(root, 'Resources'), 'Resource')) {
    const name = text(resource, 'Name')
    if (name) resources.set(text(resource, 'UID'), name)
  }
  const people = new Map<string, string[]>()
  for (const assignment of childrenLocal(childLocal(root, 'Assignments'), 'Assignment')) {
    const name = resources.get(text(assignment, 'ResourceUID'))
    if (!name) continue
    const task = text(assignment, 'TaskUID')
    people.set(task, [...(people.get(task) ?? []), name])
  }
  const lines: PlanLine[] = []
  for (const task of childrenLocal(childLocal(root, 'Tasks'), 'Task')) {
    const level = Number(text(task, 'OutlineLevel') || '1')
    // Level 0 is the project's own summary line; a null task is an empty row.
    if (level < 1 || text(task, 'IsNull') === '1') continue
    const key = text(task, 'UID')
    const links: PlanLink[] = childrenLocal(task, 'PredecessorLink').map((link) => ({
      key: text(link, 'PredecessorUID'),
      type: LINK_TYPES[text(link, 'Type')] ?? 'FS',
      lag: lagDays(link)
    }))
    const day = (name: string): string => {
      const value = text(task, name)
      return /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : ''
    }
    lines.push({
      key,
      title: text(task, 'Name'),
      level,
      start: day('Start'),
      due: day('Finish'),
      milestone: text(task, 'Milestone') === '1',
      progress: Number(text(task, 'PercentComplete')) || 0,
      people: [...new Set(people.get(key) ?? [])],
      notes: text(task, 'Notes'),
      links
    })
  }
  const keys = new Set(lines.map((line) => line.key))
  for (const line of lines) {
    const missing = line.links.filter((link) => !keys.has(link.key))
    for (const link of missing) warnings.push({ line: line.title, kind: 'link', value: link.key })
  }
  return { name: text(root, 'Title') || text(root, 'Name').replace(/\.(mpp|xml)$/i, ''), lines, warnings }
}
