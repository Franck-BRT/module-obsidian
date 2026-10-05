import type { ChatRequest } from '../../store/llm/protocol'
import { isQuiet, type WeeklyFacts } from '../../store/weekly/weeklyFacts'
import { documentOf } from '../../store/Document'
import { languageName } from '../../store/requirements/translate'
import { formatDateLetter, formatDateShort } from '../../dates'
import { displayName } from '../../utils'
import { formatMoney } from '../budget/money'
import { t } from '../../i18n'

/** The week's number, as people say it: 41 for « 2026-W41 ». */
export function weekNumber(week: string): number {
  return Number(week.slice(week.indexOf('W') + 1))
}

function days(count: number): string {
  return t('weekly.days', { count })
}

/** The few figures that head the note and the mail: progress, end, budget. */
export function keyFigures(facts: WeeklyFacts): string[] {
  const out: string[] = []
  const progress = facts.progress
  const gain = progress.before === null ? 0 : progress.now - progress.before
  out.push(
    gain
      ? t('weekly.progressGain', { progress: progress.now, gain: gain > 0 ? `+${gain}` : String(gain) })
      : t('weekly.progress', { progress: progress.now })
  )
  if (facts.end.now) {
    const shift =
      facts.end.before && facts.end.before !== facts.end.now
        ? Math.round((Date.parse(facts.end.now) - Date.parse(facts.end.before)) / 86_400_000)
        : 0
    out.push(
      shift > 0
        ? t('weekly.endLater', { date: formatDateLetter(facts.end.now), days: days(shift) })
        : shift < 0
          ? t('weekly.endEarlier', { date: formatDateLetter(facts.end.now), days: days(-shift) })
          : t('weekly.end', { date: formatDateLetter(facts.end.now) })
    )
  }
  const budget = facts.budget
  if (budget.amount || budget.forecast) {
    const variance = budget.forecast - budget.amount
    out.push(
      t('weekly.budget', {
        forecast: formatMoney(budget.forecast),
        budget: formatMoney(budget.amount),
        variance: variance ? ` (${formatMoney(variance, true)})` : ''
      })
    )
  }
  return out
}

const list = (title: string, lines: string[]): string[] =>
  lines.length ? ['', `### ${title}`, ...lines.map((line) => `- ${line}`)] : []

/** What happened, as the note lists it and as the model is told it. */
export function factsMarkdown(facts: WeeklyFacts): string {
  const who = (names: string[]): string => (names.length ? ` (${names.map(displayName).join(', ')})` : '')
  const lines: string[] = keyFigures(facts).map((line) => `- ${line}`)
  const budget = facts.budget
  const money = [
    budget.committed ? t('weekly.committed', { amount: formatMoney(budget.committed) }) : '',
    budget.invoiced ? t('weekly.invoiced', { amount: formatMoney(budget.invoiced) }) : ''
  ].filter(Boolean)
  if (money.length) lines.push(`- ${t('weekly.money', { money: money.join(', ') })}`)
  if (isQuiet(facts)) lines.push('', t('weekly.quiet'))
  lines.push(
    ...list(
      t('weekly.done', { count: facts.done.length }),
      facts.done.map((task) => `${task.title}${who(task.assignees)}`)
    ),
    ...list(
      t('weekly.late', { count: facts.late.length }),
      facts.late.map(
        ({ task, days: count, fresh }) =>
          `${task.title}${who(task.assignees)} — ${t('weekly.lateBy', { days: days(count) })}${fresh ? ` ${t('weekly.fresh')}` : ''}`
      )
    ),
    ...list(
      t('weekly.moved', { count: facts.moved.length }),
      facts.moved.map(({ task, days: count }) => {
        const words = { title: task.title, days: days(Math.abs(count)), date: formatDateShort(task.due) }
        return count > 0 ? t('weekly.movedLater', words) : t('weekly.movedEarlier', words)
      })
    )
  )
  const marks = facts.milestones
  lines.push(
    ...list(t('weekly.milestones'), [
      ...marks.met.map((task) => t('weekly.milestoneMet', { title: task.title })),
      ...marks.missed.map((task) =>
        t('weekly.milestoneMissed', { title: task.title, date: formatDateShort(task.due) })
      ),
      ...(marks.next
        ? [t('weekly.milestoneNext', { title: marks.next.title, date: formatDateShort(marks.next.due) })]
        : [])
    ]),
    ...list(t('weekly.decisions'), [
      ...facts.decisions.taken.map((task) => t('weekly.decisionTaken', { title: task.title })),
      ...facts.decisions.overdue.map((task) =>
        t('weekly.decisionOverdue', { title: task.title, date: formatDateShort(task.due) })
      )
    ]),
    ...list(t('weekly.documents'), [
      ...facts.documents.received.map((task) =>
        t('weekly.documentReceived', { title: [documentOf(task).reference, task.title].filter(Boolean).join(' — ') })
      ),
      ...facts.documents.signed.map((task) =>
        t('weekly.documentSigned', { title: [documentOf(task).reference, task.title].filter(Boolean).join(' — ') })
      )
    ])
  )
  const reserves = facts.reserves
  const moves = [
    reserves.raised ? t('weekly.reserveRaised', { count: reserves.raised }) : '',
    reserves.lifted ? t('weekly.reserveLifted', { count: reserves.lifted }) : ''
  ].filter(Boolean)
  const left = reserves.open
    ? reserves.late
      ? t('weekly.reserveOpenLate', { count: reserves.open, late: reserves.late })
      : t('weekly.reserveOpen', { count: reserves.open })
    : ''
  if (moves.length || left) lines.push(...list(t('weekly.reserves'), [[...moves, left].filter(Boolean).join(' ; ')]))
  lines.push(
    ...list(
      t('weekly.upcoming', { count: facts.upcoming.length }),
      facts.upcoming.map((task) => `${task.title} — ${formatDateShort(task.due)}${who(task.assignees)}`)
    )
  )
  return lines.join('\n')
}

/** What the model is asked: a few lines for management, from the facts alone. */
export function weeklyRequest(
  model: string,
  project: string,
  week: string,
  facts: string,
  language: string
): ChatRequest {
  const system = [
    'You write the weekly status note a project manager on a construction or engineering project sends to their management.',
    'From the facts given, and nothing else, write five to eight sentences of plain prose: first the overall state (on schedule, behind, by how much, the planned end), then what moved this week, then the points that need attention or a decision, and last what is expected next week.',
    'Be factual and sober: name the tickets, dates, amounts and companies as given; never invent a cause, a figure or an action that is not in the facts. No headings, no lists, no greeting, no signature.',
    `Write in ${languageName(language)}.`
  ].join('\n')
  return {
    model,
    temperature: 0.2,
    maxTokens: 700,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: `# ${project} — ${week}\n\n${facts}` }
    ]
  }
}

/** The mail to management: the synthesis, the key figures, the report attached. */
export function weeklyMail(
  project: string,
  week: string,
  synthesis: string,
  facts: WeeklyFacts
): { subject: string; body: string } {
  const body = [
    t('chase.mail.greeting'),
    '',
    t('weekly.mail.intro', { project, week: weekNumber(week) }),
    '',
    synthesis,
    '',
    ...keyFigures(facts).map((line) => `- ${line}`),
    '',
    t('weekly.mail.attached'),
    '',
    t('chase.mail.closing')
  ]
  return { subject: t('weekly.mail.subject', { project, week: weekNumber(week) }), body: body.join('\n') }
}

/** A mail address list as people write it: commas, semicolons, spaces. */
export function recipients(raw: string): string[] {
  return raw
    .split(/[;,\s]+/)
    .map((one) => one.trim())
    .filter((one) => /^[^@\s]+@[^@\s]+$/.test(one))
}

/** A mailto link, its brackets escaped too so it can sit inside a Markdown link. */
export function mailtoLink(to: string[], subject: string, body: string): string {
  const encode = (text: string): string => encodeURIComponent(text).replace(/\(/g, '%28').replace(/\)/g, '%29')
  return `mailto:${to.join(',')}?subject=${encode(subject)}&body=${encode(body)}`
}

export interface WeeklyNoteInput {
  project: { title: string; link: string }
  facts: WeeklyFacts
  /** The model's synthesis; '' when none could be written, with why in `missing`. */
  synthesis: string
  missing: string
  pdf: string
  to: string[]
}

/** The week's note: its synthesis, what changed, the report, and the mail ready to send. */
export function weeklyNote(input: WeeklyNoteInput): string {
  const { facts, project } = input
  const quote = (value: string): string => JSON.stringify(value)
  const synthesis = input.synthesis || keyFigures(facts).join(' · ')
  const mail = weeklyMail(project.title, facts.week, synthesis, facts)
  return [
    '---',
    'type: weekly-report',
    `project: ${quote(project.link)}`,
    `week: ${facts.week}`,
    `from: ${facts.from}`,
    `to: ${facts.to}`,
    `report: ${quote(`[[${input.pdf}]]`)}`,
    '---',
    '',
    `# ${t('weekly.title', { project: project.title, week: weekNumber(facts.week) })}`,
    '',
    t('weekly.period', { from: formatDateLetter(facts.from), to: formatDateLetter(facts.to) }),
    '',
    `## ${t('weekly.synthesis')}`,
    '',
    input.synthesis || `_${input.missing}_`,
    '',
    `## ${t('weekly.changes')}`,
    '',
    factsMarkdown(facts),
    '',
    `## ${t('weekly.report')}`,
    '',
    `[[${input.pdf}|${t('weekly.reportLink')}]]`,
    '',
    `## ${t('weekly.mail')}`,
    '',
    `**${t('weekly.mail.to')}** ${input.to.join(', ') || `_${t('weekly.mail.noRecipient')}_`}  `,
    `**${t('weekly.mail.subjectLabel')}** ${mail.subject}`,
    '',
    `[${t('weekly.mail.open')}](${mailtoLink(input.to, mail.subject, mail.body)})`,
    '',
    ...mail.body.split('\n').map((line) => `> ${line}`),
    ''
  ].join('\n')
}
