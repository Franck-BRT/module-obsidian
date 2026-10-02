import type { DocVerdict } from '../../types'
import { DOCX_TEXT_WIDTH, para, type DocxBlock, type DocxCell, type DocxDocument } from '../../store/docx'
import type { VisaSeverity, VisaSheet } from '../../store/visa/visaSheet'
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
  blocks.push(para('Heading1', t('visa.observations')))
  if (!sheet.observations.length) blocks.push(para('Normal', t('visa.noObservation')))
  else {
    const widths = [600, 1500, 4338, 1200, 2000]
    const cell = (text: string, at: number, bold = false): DocxCell => ({
      runs: [{ text, ...(bold ? { bold: true } : {}) }],
      width: widths[at]
    })
    const total = widths.reduce((sum, width) => sum + width, 0)
    if (total !== DOCX_TEXT_WIDTH) widths[2] += DOCX_TEXT_WIDTH - total
    blocks.push({
      kind: 'table',
      header: [t('visa.number'), t('visa.article'), t('visa.observation'), t('visa.severity'), t('visa.source')].map(
        (text, at) => cell(text, at, true)
      ),
      rows: sheet.observations.map((one, at) => [
        cell(String(at + 1), 0),
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
export function visaNote(sheet: VisaSheet, context: VisaContext, links: { document: string; files: string[] }): string {
  const quote = (value: string): string => JSON.stringify(value)
  const lines = [
    '---',
    'type: visa',
    `document: ${quote(links.document)}`,
    `verdict: ${sheet.verdict}`,
    `date: ${context.date}`,
    `reviewer: ${quote(context.reviewer)}`,
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
    ...(sheet.summary ? [sheet.summary, ''] : []),
    `## ${t('visa.observations')}`,
    ''
  ]
  if (!sheet.observations.length) lines.push(t('visa.noObservation'))
  else {
    lines.push(
      `| ${t('visa.number')} | ${t('visa.article')} | ${t('visa.observation')} | ${t('visa.severity')} | ${t('visa.source')} |`,
      '| --- | --- | --- | --- | --- |'
    )
    sheet.observations.forEach((one, at) => {
      const severity = severityLabel(one.severity)
      lines.push(
        `| ${at + 1} | ${cellText(one.article || '—')} | ${cellText(one.observation)} | ${one.severity === 'blocking' ? `**${severity}**` : severity} | ${cellText(one.source || '—')} |`
      )
    })
  }
  lines.push('')
  return lines.join('\n')
}
