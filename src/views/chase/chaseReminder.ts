import { Notice } from 'obsidian'
import type PMPlugin from '../../main'
import { daysSinceChase, unansweredChases } from '../../store/chasing'
import { formatDate, today } from '../../dates'
import { t } from '../../i18n'
import { chaseList, openUnansweredChases } from './ChaseModal'

/** Past this many, the notice names the first ones and counts the rest. */
const NAMED = 3

/** The days a reminder waits for its answer before the next is proposed. */
export function chaseReminderDays(plugin: PMPlugin): number {
  return Math.max(1, Number(plugin.settings.chaseReminderDays) || 7)
}

/**
 * The reminders sent and left unanswered, said once a day when Obsidian opens — who was
 * chased, when, and for which project —, with the next reminder, firmer, one click away.
 * Asked for, it is said whenever, and says too when there is none.
 */
export async function remindUnansweredChases(plugin: PMPlugin, asked = false): Promise<void> {
  const day = today().toString()
  if (!asked && (!plugin.settings.chaseReminder || plugin.settings.chaseReminderShown === day)) return
  const days = chaseReminderDays(plugin)
  const paths = plugin.index
    .projectRefs()
    .filter((ref) => !ref.template && !ref.program)
    .map((ref) => ref.path)
  const projects = await plugin.store.loadProjects(paths)
  const silent = unansweredChases(chaseList(projects, day), day, days)
  if (!asked) {
    plugin.settings.chaseReminderShown = day
    await plugin.saveSettings()
  }
  if (!silent.length) {
    if (asked) new Notice(t('chase.unansweredNone', { count: days }))
    return
  }
  const named = silent.slice(0, NAMED).map(({ project, group }) =>
    t('chase.unansweredItem', {
      issuer: group.issuer,
      project: project.title,
      date: formatDate(group.lastChase),
      days: daysSinceChase(group, day)
    })
  )
  if (silent.length > NAMED) named.push(t('chase.unansweredMore', { count: silent.length - NAMED }))
  const fragment = createFragment((el) => {
    el.createDiv({ cls: 'pm-chase-notice-title', text: t('chase.unanswered', { count: silent.length, days }) })
    const list = el.createEl('ul', { cls: 'pm-chase-notice-list' })
    for (const line of named) list.createEl('li', { text: line })
    const row = el.createDiv('pm-scan-resume-row')
    const go = row.createEl('button', { cls: 'mod-cta', text: t('chase.unansweredGo') })
    const later = row.createEl('button', { text: t('chase.unansweredLater') })
    go.addEventListener('click', (event) => {
      event.stopPropagation()
      notice.hide()
      openUnansweredChases(plugin, projects, days, () => {
        plugin.refreshViews()
        return Promise.resolve()
      })
    })
    later.addEventListener('click', (event) => {
      event.stopPropagation()
      notice.hide()
    })
  })
  const notice = new Notice(fragment, 0)
}
