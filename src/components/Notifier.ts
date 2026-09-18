import { Notice } from 'obsidian'
import type PMPlugin from '../main'
import { Temporal, today, parsePlainDate } from '../dates'
import { dueImpactNotices } from '../store/ZoneImpact'
import { t } from '../i18n'

const CHECK_INTERVAL_MS = 60 * 60 * 1000 // check every hour
/** Past this many, one line instead: a reader shown twenty notices reads none. */
const IMPACT_NOTICE_LIMIT = 3

export class Notifier {
  private intervalId: number | null = null
  private notifiedIds = new Set<string>() // prevent repeat notifications within session

  constructor(private plugin: PMPlugin) {}

  /** The first sweep runs once the index is built; this only schedules the later ones. */
  start(): void {
    this.intervalId = window.setInterval(() => {
      this.check()
    }, CHECK_INTERVAL_MS)
    this.plugin.registerInterval(this.intervalId)
  }

  stop(): void {
    if (this.intervalId !== null) {
      window.clearInterval(this.intervalId)
      this.intervalId = null
    }
  }

  /** Reads due dates from the index, so an hourly sweep loads nothing. */
  check(): void {
    if (!this.plugin.settings.notificationsEnabled) return

    const leadDays = this.plugin.settings.notificationLeadDays
    const now = today()
    const threshold = now.add({ days: leadDays })

    for (const project of this.plugin.index.projectRefs()) {
      const complete = this.plugin.index.completeStatuses(project)
      for (const task of this.plugin.index.taskRefs(project.path)) {
        const due = parsePlainDate(task.due)
        if (!due) continue
        if (task.archived || complete.has(task.status)) continue

        const cmpToToday = Temporal.PlainDate.compare(due, now)
        const isOverdue = cmpToToday < 0
        const isDueSoon = cmpToToday >= 0 && Temporal.PlainDate.compare(due, threshold) <= 0

        const notifKey = `${task.id}-${task.due}`

        if (isOverdue && !this.notifiedIds.has(notifKey + '-overdue')) {
          this.notifiedIds.add(notifKey + '-overdue')
          const daysAgo = now.since(due, { largestUnit: 'days' }).days
          new Notice(t('notify.overdue', { task: task.title, project: project.title, days: daysAgo }), 8000)
        } else if (isDueSoon && !this.notifiedIds.has(notifKey + '-soon')) {
          this.notifiedIds.add(notifKey + '-soon')
          const daysLeft = due.since(now, { largestUnit: 'days' }).days
          const msg =
            daysLeft === 0
              ? t('notify.dueToday', { task: task.title, project: project.title })
              : t('notify.dueInDays', { days: daysLeft, task: task.title, project: project.title })
          new Notice(msg, 6000)
        }
      }
    }

    this.checkImpacts(now, threshold)
  }

  /**
   * Crossings between projects, announced like a due date and in the same window.
   *
   * Only to the side being disturbed: a launch day that decides the date is not in
   * trouble, and waking its owner about the work going on around it is exactly the noise
   * the emitter-only role exists to stop.
   *
   * Several at once become one line rather than a wall of toasts. A reader who is shown
   * twenty notices reads none of them, and the view that lists them is one click away —
   * so the summary says how many and leaves the reading to the page built for it.
   */
  private checkImpacts(now: Temporal.PlainDate, threshold: Temporal.PlainDate): void {
    if (!this.plugin.radar.armed) return
    const notices = dueImpactNotices(this.plugin.radar.all(), now.toString(), threshold.toString(), (key) =>
      this.notifiedIds.has(key)
    )
    if (!notices.length) return
    for (const notice of notices) this.notifiedIds.add(notice.key)

    // A blocking crossing is never folded into a count. The cap exists so twenty mild
    // ones do not drown the screen; it must not be the reason the one that stops work
    // went unread.
    const blocking = notices.filter((notice) => notice.impact.level === 'blocking')
    const rest = notices.filter((notice) => notice.impact.level !== 'blocking')
    const spoken = rest.length > IMPACT_NOTICE_LIMIT ? blocking : notices
    if (rest.length > IMPACT_NOTICE_LIMIT) new Notice(t('notify.impactMany', { count: rest.length }), 8000)

    for (const notice of spoken) {
      const blocks = notice.impact.level === 'blocking'
      const when =
        notice.impact.from === notice.impact.to ? notice.impact.from : `${notice.impact.from} → ${notice.impact.to}`
      // Two spelled-out calls rather than one with the key chosen inside it: the
      // translation checker reads the source for literal keys and cannot follow a
      // ternary, so a key built that way reads to it as a key nobody uses.
      const params = {
        task: notice.affected.title,
        project: notice.affected.projectTitle,
        other: notice.other.title,
        otherProject: notice.other.projectTitle,
        zone: this.plugin.radar.zoneLabel(notice.impact.zone),
        when
      }
      new Notice(blocks ? t('notify.impactBlocking', params) : t('notify.impact', params), blocks ? 12000 : 9000)
    }
  }
}
