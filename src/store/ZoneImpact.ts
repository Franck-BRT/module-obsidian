/**
 * Two projects in the same place at the same time.
 *
 * A plan says when work happens; it does not say where, and a vault full of projects can
 * have three of them converging on one road in the same week without any of the three
 * knowing. A zone is that missing dimension — a place, a road, a building, whatever the
 * reader's work is organised by — and an impact is the plainest fact that can be drawn
 * from it: two tickets, different projects, same zone, dates that meet.
 *
 * Nothing here decides what to do about it. A crossing is not necessarily a problem —
 * two crews in one zone may be exactly the plan — so the tool reports and the reader
 * judges. What it must never do is stay quiet about one.
 */

/**
 * What a project does to the others it meets.
 *
 * Most projects both disturb and are disturbed. Some only disturb: a launch calendar
 * decides the day and everything else works around it, so its own days must not be
 * cluttered with what those others are doing. And the mirror exists too — a project that
 * is only ever informed and never in anyone's way.
 */
export type ProjectImpactRole = 'both' | 'emitter' | 'receiver'

export function emits(role: ProjectImpactRole): boolean {
  return role !== 'receiver'
}

export function receives(role: ProjectImpactRole): boolean {
  return role !== 'emitter'
}

/** One ticket standing in one zone for one stretch of days, both ends inclusive. */
export interface ZoneOccupancy {
  taskId: string
  title: string
  projectPath: string
  projectTitle: string
  zone: string
  start: string
  due: string
  role: ProjectImpactRole
}

export interface ZoneImpact {
  zone: string
  a: ZoneOccupancy
  b: ZoneOccupancy
  /** The days the two actually share, which is the part worth looking at. */
  from: string
  to: string
  /** Which way the disturbance runs, once each side's role is taken into account. */
  direction: 'both' | 'a-to-b' | 'b-to-a'
}

/** Whether this ticket is the one being disturbed, rather than the one doing it. */
export function affects(impact: ZoneImpact, taskId: string): boolean {
  const isA = impact.a.taskId === taskId
  if (impact.direction === 'both') return true
  return impact.direction === (isA ? 'b-to-a' : 'a-to-b')
}

/**
 * The span a ticket occupies.
 *
 * A ticket dated at one end only still stakes out that day — a milestone marks one, and
 * a task with a deadline and no start is at least there on its deadline. Empty when it
 * carries no date at all, because an undated ticket is not anywhere yet.
 */
export function spanOf(task: { start: string; due: string }): { start: string; due: string } | null {
  const start = task.start || task.due
  const due = task.due || task.start
  if (!start || !due) return null
  // Reversed dates are someone's typo, not a span running backwards.
  return start <= due ? { start, due } : { start: due, due: start }
}

export function overlaps(a: ZoneOccupancy, b: ZoneOccupancy): boolean {
  return a.start <= b.due && b.start <= a.due
}

/**
 * Every crossing, each reported once.
 *
 * Grouped by zone and swept in date order rather than compared all against all: a vault
 * of a thousand dated tickets would otherwise be half a million comparisons on every
 * redraw, and all but a handful of them between tickets months apart. Inside a zone the
 * tickets are sorted by start, so once one ends before the next begins it can be dropped
 * and never looked at again.
 *
 * Two tickets of the same project never make an impact: a project already knows what it
 * is doing to itself, and saying otherwise would bury the crossings that are news.
 */
export function zoneImpacts(occupancies: ZoneOccupancy[]): ZoneImpact[] {
  const byZone = new Map<string, ZoneOccupancy[]>()
  for (const occupancy of occupancies) {
    const held = byZone.get(occupancy.zone)
    if (held) held.push(occupancy)
    else byZone.set(occupancy.zone, [occupancy])
  }

  const out: ZoneImpact[] = []
  for (const [zone, all] of byZone) {
    const sorted = [...all].sort((a, b) => a.start.localeCompare(b.start) || a.taskId.localeCompare(b.taskId))
    const active: ZoneOccupancy[] = []
    for (const next of sorted) {
      // Anything that finished before this one starts can never meet what follows either.
      for (let i = active.length - 1; i >= 0; i--) {
        if (active[i].due < next.start) active.splice(i, 1)
      }
      for (const open of active) {
        if (open.projectPath === next.projectPath) continue
        if (!overlaps(open, next)) continue
        // A crossing exists only where one side can disturb and the other can be
        // disturbed. Two launch calendars in one zone are not each other's problem.
        const aToB = emits(open.role) && receives(next.role)
        const bToA = emits(next.role) && receives(open.role)
        if (!aToB && !bToA) continue
        out.push({
          zone,
          a: open,
          b: next,
          from: open.start > next.start ? open.start : next.start,
          to: open.due < next.due ? open.due : next.due,
          direction: aToB && bToA ? 'both' : aToB ? 'a-to-b' : 'b-to-a'
        })
      }
      active.push(next)
    }
  }
  return out
}

/**
 * The impacts each ticket is on the receiving end of.
 *
 * Only the receiving end, because this is what marks a ticket as disturbed: a launch day
 * that decides the date and is worked around is not itself in trouble, and a warning on
 * it would say the opposite of what is true. What a ticket emits is shown in the impacts
 * view, where there is room to say which way it runs.
 */
export function impactsByTask(impacts: ZoneImpact[]): Map<string, ZoneImpact[]> {
  const out = new Map<string, ZoneImpact[]>()
  const add = (id: string, impact: ZoneImpact): void => {
    const held = out.get(id)
    if (held) held.push(impact)
    else out.set(id, [impact])
  }
  for (const impact of impacts) {
    if (affects(impact, impact.a.taskId)) add(impact.a.taskId, impact)
    if (affects(impact, impact.b.taskId)) add(impact.b.taskId, impact)
  }
  return out
}

/**
 * What the other side of an impact is, seen from one ticket.
 *
 * Every impact has two ends and a reader only ever cares about the far one: "my transfer
 * meets their launch" is the sentence, and which of the two the pair happens to list
 * first is an accident of the sweep.
 */
export function otherSide(impact: ZoneImpact, taskId: string): ZoneOccupancy {
  return impact.a.taskId === taskId ? impact.b : impact.a
}

/** The impacts touching any of these projects, for a view showing only some of them. */
export function impactsForProjects(impacts: ZoneImpact[], projectPaths: string[]): ZoneImpact[] {
  const mine = new Set(projectPaths)
  return impacts.filter((impact) => mine.has(impact.a.projectPath) || mine.has(impact.b.projectPath))
}

/** What the pass needs to know, so the detector stays free of the index and the settings. */
export interface ImpactInputs {
  tasks: {
    id: string
    title: string
    projectPath: string | null
    start: string
    due: string
    status: string
    zones: string[]
    archived: boolean
  }[]
  projects: { path: string; title: string; zones: string[]; template: boolean; role: ProjectImpactRole }[]
  /** Statuses that mean the work is behind us. */
  isComplete: (status: string) => boolean
}

/**
 * Every ticket in the vault, placed in the zones it occupies.
 *
 * A ticket's own zones win; a ticket that names none stands wherever its project stands,
 * which is what lets a project entirely in one place be declared once. Four kinds of
 * ticket are left out, each for its own reason: one with no date is not anywhere yet, an
 * archived one is history, a finished one has left, and a template's tickets describe a
 * shape rather than a plan and would collide with every project made from them.
 */
export function vaultOccupancies(inputs: ImpactInputs): ZoneOccupancy[] {
  const projects = new Map(inputs.projects.map((project) => [project.path, project]))
  const out: ZoneOccupancy[] = []
  for (const task of inputs.tasks) {
    if (task.archived || inputs.isComplete(task.status)) continue
    const projectPath = task.projectPath
    if (projectPath === null) continue
    const project = projects.get(projectPath)
    if (!project || project.template) continue
    const zones = task.zones.length ? task.zones : project.zones
    if (!zones.length) continue
    const span = spanOf(task)
    if (!span) continue
    for (const zone of zones) {
      out.push({
        taskId: task.id,
        title: task.title,
        projectPath,
        projectTitle: project.title,
        zone,
        start: span.start,
        due: span.due,
        role: project.role
      })
    }
  }
  return out
}

/** One crossing worth telling somebody about, told from the side being disturbed. */
export interface ImpactNotice {
  impact: ZoneImpact
  affected: ZoneOccupancy
  other: ZoneOccupancy
  /** Stable per crossing and per window, so a date that moves is worth saying again. */
  key: string
}

/**
 * The crossings a reader should hear about now.
 *
 * Running today, or starting inside the same window a due date is announced in. One that
 * has already finished is history and saying so would only teach the reader to dismiss
 * these without reading them.
 *
 * Told to the side being disturbed, and only to that side: a launch day that decides the
 * date and is worked around is not in trouble, and waking its owner about the road crew
 * working around it is exactly the noise the emitter-only role exists to stop. A crossing
 * that disturbs both sides is worth saying to each of them, because they are two
 * different people with two different plans to change.
 */
export function dueImpactNotices(
  impacts: ZoneImpact[],
  todayIso: string,
  throughIso: string,
  seen: (key: string) => boolean
): ImpactNotice[] {
  const out: ImpactNotice[] = []
  for (const impact of impacts) {
    if (impact.to < todayIso) continue
    if (impact.from > throughIso) continue
    for (const side of [impact.a, impact.b]) {
      if (!affects(impact, side.taskId)) continue
      const other = otherSide(impact, side.taskId)
      const key = `impact:${impact.zone}:${side.taskId}:${other.taskId}:${impact.from}:${impact.to}`
      if (seen(key)) continue
      out.push({ impact, affected: side, other, key })
    }
  }
  return out
}
