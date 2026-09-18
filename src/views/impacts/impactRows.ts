import type PMPlugin from '../../main'
import { affects, otherSide, type ZoneImpact, type ZoneOccupancy } from '../../store/ZoneImpact'
import { formatDateShort } from '../../dates'
import { Chip } from '../../ui/primitives/Chip'
import { safeAsync } from '../../utils'
import { t } from '../../i18n'

/**
 * Crossings, drawn the same way wherever they are read.
 *
 * The project view and the dashboard ask the same question of the same data and differ
 * only in which projects count as "mine", so they share the drawing: two renderers would
 * have said the same thing two ways by the second change.
 */
export interface ImpactRowOpts {
  plugin: PMPlugin
  /** The projects the reader is looking out from. Empty means the whole vault is theirs. */
  mine: string[]
  /** At most this many rows per zone, so a dashboard stays a summary. */
  limit?: number
}

export function renderImpactZones(parent: HTMLElement, impacts: ZoneImpact[], opts: ImpactRowOpts): void {
  const byZone = new Map<string, ZoneImpact[]>()
  for (const impact of impacts) {
    const held = byZone.get(impact.zone)
    if (held) held.push(impact)
    else byZone.set(impact.zone, [impact])
  }

  // By zone, and inside a zone by the day the crossing starts: a reader asks "what is
  // coming on the RN7", not "what is coming, anywhere".
  for (const [zone, list] of byZone) {
    const section = parent.createDiv('pm-impacts-zone')
    const head = section.createDiv('pm-impacts-zone-head')
    const config = opts.plugin.radar.zoneConfig(zone)
    new Chip(head)
      .setLabel(opts.plugin.radar.zoneLabel(zone))
      .setVariant('solid')
      .setColor(config?.color ?? 'var(--text-muted)')
      .setLeadingIcon(config?.icon || 'map-pin')
    head.createSpan({ cls: 'pm-impacts-zone-count', text: t('impact.count', { count: list.length }) })

    const sorted = [...list].sort((a, b) => a.from.localeCompare(b.from))
    const shown = opts.limit === undefined ? sorted : sorted.slice(0, opts.limit)
    for (const impact of shown) renderImpactRow(section, impact, opts)
    // A summary that silently stops short is a summary that lies about how much there is.
    if (shown.length < sorted.length) {
      section.createDiv({ cls: 'pm-impacts-more', text: t('impact.more', { count: sorted.length - shown.length }) })
    }
  }
}

/**
 * One crossing, told from the reader's side.
 *
 * The ticket belonging to a project in view comes first, because the sentence being read
 * is "my transfer meets their launch" — which of the two the detector happened to list
 * first is an accident of how it sweeps. The verb then says which way it runs: a project
 * that only disturbs *affects* the other, and is not itself in trouble.
 */
function renderImpactRow(parent: HTMLElement, impact: ZoneImpact, opts: ImpactRowOpts): void {
  const owned = new Set(opts.mine)
  const near = owned.size === 0 || owned.has(impact.a.projectPath) ? impact.a : impact.b
  const far = otherSide(impact, near.taskId)

  const row = parent.createDiv('pm-impacts-row')
  row.createDiv({
    cls: 'pm-impacts-when',
    text:
      impact.from === impact.to
        ? formatDateShort(impact.from)
        : `${formatDateShort(impact.from)} → ${formatDateShort(impact.to)}`
  })

  const pair = row.createDiv('pm-impacts-pair')
  renderSide(pair, near, opts, true)
  // Read from the near side: it either meets the far one both ways, or affects it.
  pair.createSpan({
    cls: 'pm-impacts-meets',
    text: affects(impact, near.taskId) ? t('impact.meets') : t('impact.affects')
  })
  renderSide(pair, far, opts, false)
}

function renderSide(parent: HTMLElement, side: ZoneOccupancy, opts: ImpactRowOpts, isNear: boolean): void {
  const el = parent.createDiv(isNear ? 'pm-impacts-side pm-impacts-side--near' : 'pm-impacts-side')
  const title = el.createSpan({ cls: 'pm-impacts-title', text: side.title })
  title.addEventListener(
    'click',
    safeAsync(() => opts.plugin.router.openScope({ kind: 'project', path: side.projectPath }))
  )
  el.createSpan({ cls: 'pm-impacts-project', text: side.projectTitle })
}
