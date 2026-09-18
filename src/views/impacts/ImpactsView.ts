import type PMPlugin from '../../main'
import type { ProjectScope } from '../../store'
import { impactsForProjects, type ImpactLevel, type ZoneImpact } from '../../store/ZoneImpact'
import { IMPACT_LEVELS } from '../../types'
import { ChipButton } from '../../ui/primitives/ChipButton'
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

    const shown = this.levelFilter ? impacts.filter((impact) => impact.level === this.levelFilter) : impacts
    if (!shown.length) {
      // Reachable when the data moves under a filter that is still set. The bar stays
      // above this, so the way out is the control the reader just used.
      new EmptyState(root).setIcon('🗺️').setTitle(t('impact.noneAtLevel')).setBody(t('impact.noneAtLevelHint'))
      return
    }
    renderImpactZones(root, shown, { plugin: this.plugin, mine })
  }

  /**
   * One pill per level, counted.
   *
   * Counted against everything in view rather than against what the filter leaves, so
   * the numbers say what there is and do not rearrange themselves as they are used. A
   * level nothing is at gets no pill: an always-present "Bloquant · 0" is a thing to
   * learn to ignore.
   */
  private renderFilter(parent: HTMLElement, impacts: ZoneImpact[]): void {
    const bar = parent.createDiv('pm-impacts-bar')
    new ChipButton(bar)
      .setLabel(`${t('common.all')} · ${impacts.length}`)
      .setShape('pill')
      .setActive(this.levelFilter === null)
      .onClick(() => {
        this.levelFilter = null
        this.render()
      })

    // Gravest first, as the rows themselves are ordered.
    for (const level of IMPACT_LEVELS) {
      const count = impacts.filter((impact) => impact.level === level).length
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
  }

  refresh(): void {
    this.render()
  }
}
