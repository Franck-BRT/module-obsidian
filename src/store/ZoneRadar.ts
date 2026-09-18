import type PMPlugin from '../main'
import type { ZoneConfig } from '../types'
import { impactsByTask, vaultOccupancies, zoneImpacts, type ZoneImpact } from './ZoneImpact'

/**
 * The vault's crossings, computed once and read many times.
 *
 * Every view that marks an affected ticket asks the same question of the same data, and
 * the answer changes only when the index does. Computing it per view would walk every
 * task in the vault on every redraw of every panel; computing it here means once per
 * change, and the views look their ticket up in a map.
 *
 * It reads the index rather than loading projects: the whole point is to see across a
 * vault of them, and loading every project to find out whether two of them meet would
 * cost more than the answer is worth.
 */
export class ZoneRadar {
  private impacts: ZoneImpact[] | null = null
  private byTask: Map<string, ZoneImpact[]> | null = null

  constructor(private plugin: PMPlugin) {}

  /** Called whenever the index or the zone settings change; the next read recomputes. */
  invalidate(): void {
    this.impacts = null
    this.byTask = null
  }

  all(): ZoneImpact[] {
    if (this.impacts === null) this.compute()
    return this.impacts ?? []
  }

  /** The impacts this ticket is in, on either side. Empty when it is in none. */
  forTask(taskId: string): ZoneImpact[] {
    if (this.byTask === null) this.compute()
    return this.byTask?.get(taskId) ?? []
  }

  /** Whether the vault can produce impacts at all — no zones, nothing to say. */
  get armed(): boolean {
    return this.plugin.settings.zones.length > 0
  }

  zoneConfig(id: string): ZoneConfig | null {
    return this.plugin.settings.zones.find((zone) => zone.id === id) ?? null
  }

  /** The label to show for a zone, falling back to its stored id when it was deleted. */
  zoneLabel(id: string): string {
    return this.zoneConfig(id)?.label ?? id
  }

  private compute(): void {
    const complete = new Set(this.plugin.settings.statuses.filter((status) => status.complete).map((s) => s.id))
    const occupancies = vaultOccupancies({
      tasks: this.plugin.index.allTaskRefs(),
      projects: this.plugin.index.projectRefs().map((ref) => ({
        path: ref.path,
        title: ref.title,
        zones: ref.zones,
        template: ref.template,
        role: ref.impactRole,
        level: ref.impactLevel
      })),
      // A project's own palette can rename what "done" means, but a vault-wide pass has
      // no project in hand: the global palette is the honest approximation, and the cost
      // of being wrong is a finished ticket still listed rather than one missed.
      isComplete: (status) => complete.has(status)
    })
    this.impacts = zoneImpacts(occupancies)
    this.byTask = impactsByTask(this.impacts)
  }
}
