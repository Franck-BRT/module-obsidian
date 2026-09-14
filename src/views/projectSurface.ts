import type { PMSettings, ViewMode } from '../types'

/** Where a click on a project lands. */
export type ProjectSurface = 'subtree' | 'tasks' | 'overview'

export interface SurfaceInput {
  /** A programme has no work of its own to read. */
  program: boolean
  /** The view this project says it opens on, or null when it inherits. */
  ownDefaultView: ViewMode | null
  setting: PMSettings['projectSurface']
}

/**
 * Which surface a project link opens.
 *
 * A programme opens on everything it holds, whatever the setting says: there is nothing
 * else to show. Then a project that names its own view wins over the global setting — it
 * is the more specific of the two, and naming a view is how someone says "open this one
 * there". A project that inherits follows the setting, which is the ordinary case and is
 * left exactly as it was.
 */
export function surfaceFor(input: SurfaceInput): ProjectSurface {
  if (input.program) return 'subtree'
  if (input.ownDefaultView) return 'tasks'
  return input.setting === 'tasks' ? 'tasks' : 'overview'
}
