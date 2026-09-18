import type PMPlugin from '../../main'
import type { ProjectScope } from '../../store'
import { impactsForProjects, type ImpactLevel, type ZoneImpact } from '../../store/ZoneImpact'
import { IMPACT_LEVELS } from '../../types'
import { ChipButton } from '../../ui/primitives/ChipButton'
import { renderSelectControl } from '../../ui/composites/properties'
import { impactLevelColor, impactLevelLabel } from './impactRole'
import { renderImpactZones } from './impactRows'
import { EmptyState } from '../../ui/primitives/EmptyState'
import { SUBVIEW_CLASS } from '../subviewClasses'
import type { SubView } from '../SubView'
import { t } from '../../i18n'

/**
 * Where this project's plan meets somebody else's.
 *
 * A plan says when work happens and never says where, so two projects can converge on
 * one road in the same week with neither of them able to know. This is the view that
 * says so: for every zone the projects in view stand in, the tickets from elsewhere that
 * stand in it at the same time, and the days they share.
 *
 * It reports rather than judges. Two crews in one zone may be exactly the plan — what
 * the tool owes the reader is that the crossing is never a surprise, not an opinion
 * about whether it is a problem.
 */
export class ImpactsView implements SubView {
  /**
   * Which level the reader is looking at, or all of them.
   *
   * Kept on the view rather than in the settings, like the library's own state filter:
   * "show me only what blocks" is a question asked while looking at something, not a
   * standing preference, and a filter that survived a restart would hide crossings from
   * a reader who had forgotten setting it.
   */
  private levelFilter: ImpactLevel | null = null
  /**
   * Which zone, or all of them. A select rather than pills like the levels: there are
   * three levels and there is no telling how many zones, and twenty pills is a wall
   * where a searchable list is a question.
   */
  private zoneFilter: string | null = null

  constructor(
    private container: HTMLElement,
    private scope: ProjectScope,
    private plugin: PMPlugin
  ) {}

  render(): void {
    this.container.empty()
    this.container.addClass(SUBVIEW_CLASS.impacts)

    if (!this.plugin.radar.armed) {
      new EmptyState(this.container).setIcon('🗺️').setTitle(t('impact.noZones')).setBody(t('settings.zones.desc'))
      return
    }

    const mine = this.scope.projects.map((project) => project.filePath)
    const impacts = impactsForProjects(this.plugin.radar.all(), mine)
    if (!impacts.length) {
      new EmptyState(this.container).setIcon('🗺️').setTitle(t('impact.none')).setBody(t('impact.noneHint'))
      return
    }

    const root = this.container.createDiv('pm-impacts')
    this.renderFilter(root, impacts)

    const shown = impacts.filter((impact) => this.atLevel(impact) && this.inZone(impact))
    if (!shown.length) {
      // Reachable by narrowing on both at once, and when the data moves under a filter
      // still set. The bar stays above this, so the way out is the control just used.
      new EmptyState(root).setIcon('🗺️').setTitle(t('impact.noneHere')).setBody(t('impact.noneHereHint'))
      return
    }
    renderImpactZones(root, shown, {
      plugin: this.plugin,
      mine,
      // Inside this view the heading and the level narrow in place rather than opening
      // anything: the same gesture meaning the same thing where it costs nothing.
      onZone: (zone) => {
        this.zoneFilter = zone
        this.render()
      },
      onLevel: (level) => {
        this.levelFilter = level
        this.render()
      }
    })
  }

  /**
   * One pill per level, counted.
   *
   * Counted against everything in view rather than against what the filter leaves, so
   * the numbers say what there is and do not rearrange themselves as they are used. A
   * level nothing is at gets no pill: an always-present "Bloquant · 0" is a thing to
   * learn to ignore.
   */
  private atLevel(impact: ZoneImpact): boolean {
    return this.levelFilter === null || impact.level === this.levelFilter
  }

  private inZone(impact: ZoneImpact): boolean {
    return this.zoneFilter === null || impact.zone === this.zoneFilter
  }

  /**
   * The two questions asked of the same list, each counted under the other's answer.
   *
   * Counting a level against the chosen zone, and a zone against the chosen level, is
   * what keeps the two from leading anywhere empty: every choice still on offer has
   * something behind it, and a choice with nothing behind it is not offered at all. The
   * alternative — counting both against everything — shows numbers that are true of the
   * page and false of the click.
   */
  private renderFilter(parent: HTMLElement, impacts: ZoneImpact[]): void {
    const bar = parent.createDiv('pm-impacts-bar')
    const inZone = impacts.filter((impact) => this.inZone(impact))

    new ChipButton(bar)
      .setLabel(`${t('common.all')} · ${inZone.length}`)
      .setShape('pill')
      .setActive(this.levelFilter === null)
      .onClick(() => {
        this.levelFilter = null
        this.render()
      })

    // Gravest first, as the rows themselves are ordered.
    for (const level of IMPACT_LEVELS) {
      const count = inZone.filter((impact) => impact.level === level).length
      if (!count) continue
      const chip = new ChipButton(bar)
        .setLabel(`${impactLevelLabel(level)} · ${count}`)
        .setShape('pill')
        .setActive(this.levelFilter === level)
        .onClick(() => {
          // Clicking the one already on clears it, so the filter never becomes a trap.
          this.levelFilter = this.levelFilter === level ? null : level
          this.render()
        })
      chip.el.style.setProperty('--pm-chip-color', impactLevelColor(level))
    }

    this.renderZoneFilter(
      bar.createDiv('pm-impacts-bar-right'),
      impacts.filter((impact) => this.atLevel(impact))
    )
  }

  private renderZoneFilter(parent: HTMLElement, atLevel: ZoneImpact[]): void {
    const counts = new Map<string, number>()
    for (const impact of atLevel) counts.set(impact.zone, (counts.get(impact.zone) ?? 0) + 1)

    const options = [...counts.entries()].map(([zone, count]) => {
      const config = this.plugin.radar.zoneConfig(zone)
      return {
        id: zone,
        label: `${this.plugin.radar.zoneLabel(zone)} · ${count}`,
        color: config?.color,
        icon: config?.icon || 'map-pin'
      }
    })
    // The chosen zone stays on offer even when the level filter has emptied it, or there
    // would be no way back to "all" but to guess that the select still opens.
    if (this.zoneFilter !== null && !counts.has(this.zoneFilter)) {
      options.push({
        id: this.zoneFilter,
        label: `${this.plugin.radar.zoneLabel(this.zoneFilter)} · 0`,
        color: undefined,
        icon: 'map-pin'
      })
    }

    renderSelectControl({
      container: parent,
      value: this.zoneFilter ?? '',
      search: options.length > 6,
      options: [{ id: '', label: t('impact.allZones'), icon: 'map' }, ...options],
      onChange: (id) => {
        this.zoneFilter = id || null
        this.render()
      }
    })
  }

  /** Opens narrowed, for a link that already knows what was pointed at. */
  openAt(filter: { zone?: string | null; level?: ImpactLevel | null }): void {
    if (filter.zone !== undefined) this.zoneFilter = filter.zone
    if (filter.level !== undefined) this.levelFilter = filter.level
  }

  refresh(): void {
    this.render()
  }
}
