/**
 * The tickets that are work, counted in a project's progress and its lateness: not a lot,
 * which holds work and has a span of its own; not a risk, a decision nor a reserve, each
 * followed in a register of its own, with its own dates.
 *
 * One rule for every place that counts — the projects' list, the overview, the
 * dashboard —, so that « 1 en retard » in one is one in the others.
 */
const NOT_WORK = new Set(['phase', 'risk', 'decision', 'reserve', 'change'])

export function isWork(task: { type: string }): boolean {
  return !NOT_WORK.has(task.type)
}
