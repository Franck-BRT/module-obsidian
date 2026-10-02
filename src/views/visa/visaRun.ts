import { normalizePath, TFile } from 'obsidian'
import type PMPlugin from '../../main'
import type { Project, Task } from '../../types'
import type { LibraryDoc } from '../../store/library/libraryDoc'
import type { Requirement } from '../../store/requirements/Requirement'
import { displayText } from '../../store/requirements/Requirement'
import { documentOf, recordApproval } from '../../store/Document'
import { extractText } from '../../store/library/docText'
import { LlmClient } from '../../store/llm/client'
import { chatModel } from '../../store/chat/chatModels'
import { readVisaReply, visaRequest, type VisaSheet } from '../../store/visa/visaSheet'
import { buildDocx } from '../../store/docx'
import { buildPdf } from '../../store/pdf'
import { ensureFolder, folderOf } from '../../store/vaultFs'
import { saveDocument } from '../library/saveDocument'
import { sanitizeFileName } from '../../utils'
import { currentLocale, t } from '../../i18n'
import { verdictLabel, visaDocument, visaNote, type VisaContext } from './visaDocument'

/** The documents a sheet is usually read against: specifications, programmes, standards. */
const REFERENCE_WORDS =
  /\b(cctp|cctg|ccap|ccag|cahier|programme|specification|spécification|exigences?|requirements?|norme|standard|dtu|eurocode|marché|contrat|sow|statement of work)\b/i

/** The library's documents of the project, the reviewed one aside, and those to tick at first. */
export function visaCandidates(
  plugin: PMPlugin,
  project: Project,
  task: Task
): { docs: LibraryDoc[]; preselected: Set<string> } {
  const own = documentOf(task).file
  const docs = plugin.library
    .docs()
    .filter((doc) => doc.projects.includes(project.filePath) && doc.file && doc.file !== own)
    .sort((a, b) => a.title.localeCompare(b.title))
  const preselected = new Set(
    docs.filter((doc) => REFERENCE_WORDS.test(`${doc.title} ${doc.category} ${doc.file}`)).map((doc) => doc.record)
  )
  return { docs, preselected }
}

/** The requirements the project's notes quote. */
export function projectRequirements(plugin: PMPlugin, project: Project): Requirement[] {
  const folder = folderOf(project.filePath)
  const usage = plugin.reqUsage.usage()
  return plugin.index.requirementRefs().filter((requirement) => {
    const notes = usage.get(requirement.id) ?? []
    return notes.some((path) => !folder || path === project.filePath || path.startsWith(`${folder}/`))
  })
}

/** A file's text: as the library read it — a scan included, once read —, or read now. */
export async function fileText(plugin: PMPlugin, path: string): Promise<string> {
  const doc = plugin.library.docs().find((one) => one.file === path)
  const kept = doc ? plugin.libraryText.entry(doc) : undefined
  if (kept?.text.trim()) return kept.text
  const file = plugin.app.vault.getAbstractFileByPath(path)
  if (!(file instanceof TFile)) return ''
  const read = await extractText(file.name, new Uint8Array(await plugin.app.vault.readBinary(file)), {
    from: t('email.from'),
    to: t('email.to'),
    date: t('email.date'),
    attachments: t('library.mailAttachments')
  })
  return read.text
}

export class VisaNoModel extends Error {}
export class VisaUnreadable extends Error {}

/** The model's draft of the sheet, the document read against the references and requirements ticked. */
export async function draftVisa(
  plugin: PMPlugin,
  task: Task,
  references: LibraryDoc[],
  requirements: Requirement[]
): Promise<VisaSheet> {
  const llm = plugin.settings.llm
  const model = chatModel(plugin.settings.chat.model, llm.modelText)
  if (!llm.enabled || !llm.baseUrl.trim() || !model) throw new VisaNoModel()
  const meta = documentOf(task)
  const request = visaRequest(model, {
    document: {
      title: task.title,
      reference: meta.reference,
      issue: meta.issue,
      issuer: meta.issuer,
      file: meta.file.slice(meta.file.lastIndexOf('/') + 1),
      text: await fileText(plugin, meta.file)
    },
    references: await Promise.all(
      references.map(async (doc) => ({ name: doc.title, text: await fileText(plugin, doc.file) }))
    ),
    requirements: requirements.map((one) => ({
      id: one.id,
      title: one.title,
      text: displayText(one, one.sourceLang)?.body ?? ''
    })),
    language: currentLocale()
  })
  const reply = await new LlmClient({ settings: llm }).chat(request)
  const sheet = readVisaReply(reply)
  if (!sheet) throw new VisaUnreadable()
  return sheet
}

/** A name for a new file in a folder, numbered past the ones already there. */
function freePath(plugin: PMPlugin, folder: string, base: string, ext: string): string {
  let path = normalizePath(`${folder}/${base}.${ext}`)
  for (let n = 2; plugin.app.vault.getAbstractFileByPath(path); n++) {
    path = normalizePath(`${folder}/${base} (${n}).${ext}`)
  }
  return path
}

/**
 * The sheet validated: kept as a note in the project's visas — with, asked for, its Word
 * and PDF copies to send —, and the reviewer's verdict entered in the document's visa
 * circuit, the sheet linked from it. The note's path comes back.
 */
export async function saveVisa(
  plugin: PMPlugin,
  project: Project,
  task: Task,
  sheet: VisaSheet,
  context: VisaContext,
  exports: boolean,
  onRefresh: () => Promise<void>
): Promise<string> {
  const root = folderOf(project.filePath)
  const folder = normalizePath(root ? `${root}/${t('visa.folder')}` : t('visa.folder'))
  await ensureFolder(plugin.app, folder)
  const doc = context.document
  const base = sanitizeFileName(
    [
      t('visa.sheetTitle'),
      doc.reference || doc.title,
      doc.issue ? t('chase.mail.issue', { issue: doc.issue }) : '',
      context.date
    ]
      .filter(Boolean)
      .join(' ')
  )
  const files: string[] = []
  if (exports) {
    const document = visaDocument(sheet, context)
    const docx = freePath(plugin, folder, base, 'docx')
    await plugin.app.vault.createBinary(docx, buildDocx(document).slice().buffer)
    const pdf = freePath(plugin, folder, base, 'pdf')
    await plugin.app.vault.createBinary(pdf, buildPdf(document).slice().buffer)
    files.push(`[[${docx}|Word]]`, `[[${pdf}|PDF]]`)
  }
  const notePath = freePath(plugin, folder, base, 'md')
  const documentLink = task.filePath ? `[[${task.filePath}|${task.title}]]` : task.title
  await plugin.app.vault.create(notePath, visaNote(sheet, context, { document: documentLink, files }))
  const note = `${verdictLabel(sheet.verdict)} — [[${notePath}|${t('visa.sheetTitle')}]]`
  const meta = recordApproval(documentOf(task), {
    by: context.reviewer,
    at: new Date().toISOString(),
    verdict: sheet.verdict,
    note
  })
  await saveDocument(plugin, project, task, meta, onRefresh)
  return notePath
}
