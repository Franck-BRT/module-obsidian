import type PMPlugin from '../../main'
import type { ProjectScope } from '../../store'
import { impactsForProjects, otherSide, type ZoneImpact, type ZoneOccupancy } from '../../store/ZoneImpact'
import { formatDateShort } from '../../dates'
import { EmptyState } from '../../ui/primitives/EmptyState'
import { Chip } from '../../ui/primitives/Chip'
import { safeAsync } from '../../utils'
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

    const byZone = new Map<string, ZoneImpact[]>()
    for (const impact of impacts) {
      const held = byZone.get(impact.zone)
      if (held) held.push(impact)
      else byZone.set(impact.zone, [impact])
    }

    const root = this.container.createDiv('pm-impacts')
    root.createDiv({ cls: 'pm-impacts-count', text: t('impact.count', { count: impacts.length }) })
    // By zone, and inside a zone by the day the crossing starts: a reader asks "what is
    // coming on the RN7", not "what is coming, anywhere".
    for (const [zone, list] of byZone) {
      const section = root.createDiv('pm-impacts-zone')
      const head = section.createDiv('pm-impacts-zone-head')
      const config = this.plugin.radar.zoneConfig(zone)
      new Chip(head)
        .setLabel(this.plugin.radar.zoneLabel(zone))
        .setVariant('solid')
        .setColor(config?.color ?? 'var(--text-muted)')
        .setLeadingIcon(config?.icon || 'map-pin')
      head.createSpan({ cls: 'pm-impacts-zone-count', text: t('impact.count', { count: list.length }) })
      const sorted = [...list].sort((a, b) => a.from.localeCompare(b.from))
      for (const impact of sorted) this.renderRow(section, impact, mine)
    }
  }

  refresh(): void {
    this.render()
  }

  /**
   * One crossing, told from the reader's side.
   *
   * The ticket belonging to a project in view comes first and the other second, because
   * the sentence a reader is reading is "my transfer meets their launch" — which of the
   * two the detector happened to list first is an accident of how it sweeps.
   */
  private renderRow(parent: HTMLElement, impact: ZoneImpact, mine: string[]): void {
    const owned = new Set(mine)
    const near = owned.has(impact.a.projectPath) ? impact.a : impact.b
    const far = otherSide(impact, near.taskId)

    const row = parent.createDiv('pm-impacts-row')
    const when = row.createDiv('pm-impacts-when')
    when.createSpan({
      text:
        impact.from === impact.to
          ? formatDateShort(impact.from)
          : `${formatDateShort(impact.from)} → ${formatDateShort(impact.to)}`
    })

    const pair = row.createDiv('pm-impacts-pair')
    this.renderSide(pair, near, true)
    pair.createSpan({ cls: 'pm-impacts-meets', text: t('impact.meets') })
    this.renderSide(pair, far, false)
  }

  private renderSide(parent: HTMLElement, side: ZoneOccupancy, isNear: boolean): void {
    const el = parent.createDiv(isNear ? 'pm-impacts-side pm-impacts-side--near' : 'pm-impacts-side')
    const title = el.createSpan({ cls: 'pm-impacts-title', text: side.title })
    title.addEventListener(
      'click',
      safeAsync(() => this.plugin.router.openScope({ kind: 'project', path: side.projectPath }))
    )
    el.createSpan({ cls: 'pm-impacts-project', text: side.projectTitle })
  }
}
