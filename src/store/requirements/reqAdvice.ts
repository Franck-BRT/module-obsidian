import { axisWeight, QUALITY_AXES, type QualityAxisId, type QualityReport } from './reqScore'

/**
 * What to do next, and what it is worth.
 *
 * The arithmetic is ours and the prose is the model's, and that division is the point. A
 * model can write a better sentence; it cannot know that fixing this axis is worth twelve
 * points and that one four, because the rubric is here and not in it. Asking it to guess
 * produces advice that sounds right and moves nothing — which is the failure mode of
 * every "AI suggestion" that nobody checks.
 *
 * So the gaps are measured here, ranked here, and the model is asked to say how to close
 * the ones that were chosen.
 */

export interface Improvement {
  axis: QualityAxisId
  /** What that axis is missing, as rule ids and field names the view translates. */
  misses: string[]
  /** What closing it entirely would add to the score, from 0 to 1. */
  gain: number
}

export interface ImprovementPlan {
  /** Where the reader wants to be, from 0 to 1. */
  target: number
  current: number
  improvements: Improvement[]
  /** Where making every listed improvement would land. */
  reachable: number
  /** Whether the listed improvements are enough to reach the target. */
  enough: boolean
  /** Already there: nothing is proposed, and saying nothing would look like a failure. */
  met: boolean
}

/**
 * The improvements worth most, largest first.
 *
 * An axis already perfect is not proposed — a suggestion worth nothing teaches a reader
 * to stop reading suggestions — and the list is capped, because three things to do is a
 * plan and eight is a backlog.
 */
export function improvementPlan(report: QualityReport, target: number, count = 3): ImprovementPlan {
  const improvements = report.axes
    .map((axis) => ({ axis: axis.id, misses: axis.misses, gain: axisWeight(axis.id) * (1 - axis.score) }))
    .filter((improvement) => improvement.gain > 0.0001)
    // Ties broken by the order the axes are declared in, which runs wording first: two
    // gaps worth the same are not equally worth fixing, and a badly worded requirement
    // wants rewriting before it wants a link.
    .sort((one, other) => other.gain - one.gain || QUALITY_AXES.indexOf(one.axis) - QUALITY_AXES.indexOf(other.axis))
    .slice(0, count)

  const reachable = Math.min(1, report.score + improvements.reduce((sum, entry) => sum + entry.gain, 0))
  return {
    target,
    current: report.score,
    improvements,
    reachable,
    // Compared with a hair of room, because a score of exactly the target read back from
    // floating point is otherwise a coin toss.
    enough: reachable + 1e-9 >= target,
    met: report.score + 1e-9 >= target
  }
}

/** Everything the plan would fix, for a prompt that has to name what it is advising on. */
export function planMisses(plan: ImprovementPlan): string[] {
  return plan.improvements.flatMap((improvement) => improvement.misses)
}
