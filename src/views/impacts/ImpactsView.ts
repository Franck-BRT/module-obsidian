import type PMPlugin from '../../main'
import type { ProjectScope } from '../../store'
import { impactsForProjects } from '../../store/ZoneImpact'
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
    root.createDiv({ cls: 'pm-impacts-count', text: t('impact.count', { count: impacts.length }) })
    renderImpactZones(root, impacts, { plugin: this.plugin, mine })
  }

  refresh(): void {
    this.render()
  }
}
