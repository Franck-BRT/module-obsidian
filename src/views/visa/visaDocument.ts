import type { DocVerdict } from '../../types'
import { DOCX_TEXT_WIDTH, para, type DocxBlock, type DocxCell, type DocxDocument } from '../../store/docx'
import { numberObservations, type LiftState, type VisaSeverity, type VisaSheet } from '../../store/visa/visaSheet'
import { formatDateLetter } from '../../dates'
import { t } from '../../i18n'

/** What a sheet is about: the document, who reviews it, when, against what. */
export interface VisaContext {
  project: string
  document: { title: string; reference: string; issue: string; issuer: string; file: string }
  reviewer: string
  /** YYYY-MM-DD. */
  date: string
  references: string[]
  requirements: string[]
}

export function severityLabel(severity: VisaSeverity): string {
  switch (severity) {
    case 'minor':
      return t('visa.severity.minor')
    case 'major':
      return t('visa.severity.major')
    case 'blocking':
      return t('visa.severity.blocking')
  }
}

export function liftLabel(state: LiftState): string {
  switch (state) {
    case 'lifted':
      return t('visa.lift.lifted')
    case 'partial':
      return t('visa.lift.partial')
    case 'open':
      return t('visa.lift.open')
  }
}

export function verdictLabel(verdict: DocVerdict): string {
  switch (verdict) {
    case 'approved':
      return t('visa.verdict.approved')
    case 'observations':
      return t('visa.verdict.observations')
    case 'rejected':
      return t('visa.verdict.rejected')
  }
}

/** The document's name as a sheet heads it: its reference, its title, its issue. */
export function documentName(context: VisaContext): string {
  const doc = context.document
  return [doc.reference, doc.title, doc.issue ? t('chase.mail.issue', { issue: doc.issue }) : '']
    .filter(Boolean)
    .join(' — ')
}

/** The sheet as a document, for Word and for PDF alike. */
export function visaDocument(sheet: VisaSheet, context: VisaContext): DocxDocument {
  const doc = context.document
  const blocks: DocxBlock[] = [
    para('Title', t('visa.sheetTitle')),
    para('Heading2', documentName(context)),
    para(
      'Meta',
      [
        `${t('visa.project')} : ${context.project}`,
        doc.issuer && `${t('doc.issuer')} : ${doc.issuer}`,
        doc.file && `${t('visa.file')} : ${doc.file}`,
        `${t('visa.reviewedBy')} : ${context.reviewer || '—'}, ${formatDateLetter(context.date)}`
      ]
        .filter(Boolean)
        .join(' · ')
    )
  ]
  if (context.references.length || context.requirements.length) {
    blocks.push(
      para(
        'Meta',
        [
          context.references.length && `${t('visa.checkedAgainst')} : ${context.references.join(', ')}`,
          context.requirements.length && `${t('visa.requirements')} : ${context.requirements.join(', ')}`
        ]
          .filter(Boolean)
          .join(' · ')
      )
    )
  }
  blocks.push({
    kind: 'p',
    style: 'Heading1',
    runs: [{ text: `${t('visa.verdict')} : ` }, { text: verdictLabel(sheet.verdict) }]
  })
  if (sheet.summary) blocks.push(para('Normal', sheet.summary))
  const cells = (widths: number[]) => {
    const total = widths.reduce((sum, width) => sum + width, 0)
    if (total !== DOCX_TEXT_WIDTH) widths[2] += DOCX_TEXT_WIDTH - total
    return (text: string, at: number, bold = false): DocxCell => ({
      runs: [{ text, ...(bold ? { bold: true } : {}) }],
      width: widths[at]
    })
  }
  if (sheet.carried?.length) {
    blocks.push(para('Heading1', t('visa.liftTitle', { issue: sheet.previous?.issue || '—' })))
    const cell = cells([700, 1600, 3238, 1800, 2300])
    blocks.push({
      kind: 'table',
      header: [t('visa.number'), t('visa.article'), t('visa.observation'), t('visa.liftState'), t('visa.liftNote')].map(
        (text, at) => cell(text, at, true)
      ),
      rows: sheet.carried.map((one) => [
        cell(one.ref, 0),
        cell(one.article || '—', 1),
        cell(`${one.observation} (${severityLabel(one.severity)})`, 2),
        cell(liftLabel(one.state), 3, one.state !== 'lifted'),
        cell(one.note || '—', 4)
      ])
    })
  }
  blocks.push(para('Heading1', sheet.carried?.length ? t('visa.newObservations') : t('visa.observations')))
  if (!sheet.observations.length) blocks.push(para('Normal', t('visa.noObservation')))
  else {
    const cell = cells([700, 1500, 4238, 1200, 2000])
    blocks.push({
      kind: 'table',
      header: [t('visa.number'), t('visa.article'), t('visa.observation'), t('visa.severity'), t('visa.source')].map(
        (text, at) => cell(text, at, true)
      ),
      rows: numberObservations(doc.issue, sheet.observations).map((one) => [
        cell(one.ref, 0),
        cell(one.article || '—', 1),
        cell(one.observation, 2),
        cell(severityLabel(one.severity), 3, one.severity === 'blocking'),
        cell(one.source || '—', 4)
      ])
    })
  }
  blocks.push(para('Meta', t('visa.footer')))
  return { title: `${t('visa.sheetTitle')} — ${documentName(context)}`, blocks }
}

const cellText = (text: string): string => text.replace(/\|/g, '\\|').replace(/\n+/g, ' ')

/** The sheet as a note of the vault: its properties, its verdict, its table, links to its files. */
export function visaNote(
  sheet: VisaSheet,
  context: VisaContext,
  links: { document: string; files: string[]; task?: string }
): string {
  const quote = (value: string): string => JSON.stringify(value)
  const fresh = numberObservations(context.document.issue, sheet.observations)
  // Every observation as the next issue reads it back: those carried with where they stand, the new ones open.
  const kept = [
    ...(sheet.carried ?? []).map(({ ref, article, observation, severity, source, state, note }) => ({
      ref,
      article,
      observation,
      severity,
      source,
      state,
      note
    })),
    ...fresh.map(({ ref, article, observation, severity, source }) => ({
      ref,
      article,
      observation,
      severity,
      source,
      state: 'open',
      note: ''
    }))
  ]
  const lines = [
    '---',
    'type: visa',
    `document: ${quote(links.document)}`,
    ...(links.task ? [`task: ${quote(links.task)}`] : []),
    `reference: ${quote(context.document.reference)}`,
    `issue: ${quote(context.document.issue)}`,
    `verdict: ${sheet.verdict}`,
    `date: ${context.date}`,
    `reviewer: ${quote(context.reviewer)}`,
    ...(sheet.previous ? [`previous: ${quote(`[[${sheet.previous.sheet}]]`)}`] : []),
    ...(kept.length ? ['observations:', ...kept.map((one) => `  - ${JSON.stringify(one)}`)] : ['observations: []']),
    '---',
    '',
    `# ${t('visa.sheetTitle')} — ${documentName(context)}`,
    '',
    `${t('visa.document')} : ${links.document}${links.files.length ? ` · ${links.files.join(' · ')}` : ''}`,
    `${t('visa.reviewedBy')} : ${context.reviewer || '—'}, ${formatDateLetter(context.date)}`,
    ...(context.references.length ? [`${t('visa.checkedAgainst')} : ${context.references.join(', ')}`] : []),
    ...(context.requirements.length ? [`${t('visa.requirements')} : ${context.requirements.join(', ')}`] : []),
    '',
    `## ${t('visa.verdict')} : ${verdictLabel(sheet.verdict)}`,
    '',
    ...(sheet.summary ? [sheet.summary, ''] : [])
  ]
  if (sheet.carried?.length) {
    lines.push(
      `## ${t('visa.liftTitle', { issue: sheet.previous?.issue || '—' })}`,
      '',
      ...(sheet.previous ? [`${t('visa.previousSheet')} : [[${sheet.previous.sheet}]]`, ''] : []),
      `| ${t('visa.number')} | ${t('visa.article')} | ${t('visa.observation')} | ${t('visa.severity')} | ${t('visa.liftState')} | ${t('visa.liftNote')} |`,
      '| --- | --- | --- | --- | --- | --- |'
    )
    for (const one of sheet.carried) {
      const state = liftLabel(one.state)
      lines.push(
        `| ${one.ref} | ${cellText(one.article || '—')} | ${cellText(one.observation)} | ${severityLabel(one.severity)} | ${one.state === 'lifted' ? state : `**${state}**`} | ${cellText(one.note || '—')} |`
      )
    }
    lines.push('')
  }
  lines.push(`## ${sheet.carried?.length ? t('visa.newObservations') : t('visa.observations')}`, '')
  if (!fresh.length) lines.push(t('visa.noObservation'))
  else {
    lines.push(
      `| ${t('visa.number')} | ${t('visa.article')} | ${t('visa.observation')} | ${t('visa.severity')} | ${t('visa.source')} |`,
      '| --- | --- | --- | --- | --- |'
    )
    for (const one of fresh) {
      const severity = severityLabel(one.severity)
      lines.push(
        `| ${one.ref} | ${cellText(one.article || '—')} | ${cellText(one.observation)} | ${one.severity === 'blocking' ? `**${severity}**` : severity} | ${cellText(one.source || '—')} |`
      )
    }
  }
  lines.push('')
  return lines.join('\n')
}
