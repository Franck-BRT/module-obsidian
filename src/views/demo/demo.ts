import { Notice, normalizePath, TFile } from 'obsidian'
import type PMPlugin from '../../main'
import type { DemoManifest, Project, Task } from '../../types'
import { buildDocx } from '../../store/docx'
import { ContactBook, readContacts, saveContact } from '../../store/contacts'
import { projectDocsFolder } from '../../store/DocumentStore'
import { ensureFolder, folderOf } from '../../store/vaultFs'
import { today } from '../../dates'
import { t } from '../../i18n'
import {
  b12Tasks,
  c7Tasks,
  calculationNote,
  calculationTask,
  cctpDocument,
  DEMO_B12,
  DEMO_C7,
  DEMO_CONTACTS,
  DEMO_REQUIREMENTS,
  demoGuide,
  englishSow
} from './demoContent'

/** The library's folder the demonstration's documents go in. */
const LIBRARY_FOLDER = 'Démo'

/** A ticket and what hangs under it, each written as the editor writes one. */
async function insertTree(plugin: PMPlugin, project: Project, task: Task, parentId: string | null): Promise<void> {
  const children = task.subtasks
  task.subtasks = []
  await plugin.store.insertTask(project, task, parentId)
  for (const child of children) await insertTree(plugin, project, child, task.id)
}

async function writeBytes(plugin: PMPlugin, path: string, bytes: Uint8Array): Promise<string> {
  await ensureFolder(plugin.app, folderOf(path))
  const existing = plugin.app.vault.getAbstractFileByPath(path)
  if (existing instanceof TFile) await plugin.app.vault.modifyBinary(existing, bytes.slice().buffer)
  else await plugin.app.vault.createBinary(path, bytes.slice().buffer)
  return path
}

/**
 * Builds the demonstration: two projects, their people, the requirements and the
 * documents they rely on, and the note that says what to try. Refused when one is there
 * already; the first project's dashboard opens on it.
 */
export async function createDemo(plugin: PMPlugin): Promise<void> {
  if (plugin.settings.demo) {
    new Notice(t('demo.exists'))
    return
  }
  const manifest: DemoManifest = { projects: [], contacts: [], requirements: [], library: [], notes: [] }
  // Kept from the first write on, so a demonstration cut short can still be taken away.
  const keep = async (): Promise<void> => {
    plugin.settings.demo = manifest
    await plugin.saveSettings()
  }
  const day = today().toString()
  const folder = plugin.settings.projectsFolder.trim() || 'Projects'

  // Its people, those already known left as they are.
  const book = new ContactBook(readContacts(plugin.app, plugin.settings.peopleFolder))
  for (const contact of DEMO_CONTACTS) {
    if (book.find(contact.name)) continue
    const path = await saveContact(plugin.app, plugin.settings.peopleFolder, null, contact.name, {
      kind: contact.kind,
      company: contact.company ?? '',
      role: contact.role,
      email: contact.email ?? '',
      phone: contact.phone ?? '',
      lots: contact.lots ?? [],
      capacity: contact.capacity
    })
    manifest.contacts.push(path)
  }
  await keep()

  const b12 = await plugin.store.createProject(DEMO_B12, folder, {
    teamMembers: ['Anne Leroy', 'Paul Martin'],
    description: t('demo.projectDescription')
  })
  manifest.projects.push(b12.filePath)
  const c7 = await plugin.store.createProject(DEMO_C7, folder, {
    teamMembers: ['Anne Leroy', 'Paul Martin'],
    description: t('demo.projectDescription')
  })
  manifest.projects.push(c7.filePath)
  await keep()
  for (const task of b12Tasks(day)) await insertTree(plugin, b12, task, null)
  for (const task of c7Tasks(day)) await insertTree(plugin, c7, task, null)

  // The calculation note to review, its file in the project's documents.
  const docs = projectDocsFolder(plugin.app, b12.filePath)
  const notePath = await writeBytes(
    plugin,
    normalizePath(`${docs}/NDC-04 Note de calcul radier indice B.docx`),
    buildDocx(calculationNote('B'))
  )
  await plugin.store.insertTask(b12, calculationTask(day, notePath))

  // The requirements, under ids of their own, and the note of the project that quotes them.
  for (const requirement of DEMO_REQUIREMENTS) {
    if (plugin.index.requirementRefs().some((one) => one.id === requirement.id)) continue
    const now = new Date().toISOString()
    const made = await plugin.requirements.create({
      id: requirement.id,
      title: requirement.title,
      category: 'GO',
      sourceLang: 'fr',
      text: { fr: { body: requirement.text, fromRev: 1, at: now, by: '', origin: 'human', reviewed: true } }
    })
    if (made?.filePath) manifest.requirements.push(made.filePath)
  }
  const root = folderOf(b12.filePath)
  const quoting = normalizePath(`${root}/Exigences du lot 02.md`)
  if (!plugin.app.vault.getAbstractFileByPath(quoting)) {
    await plugin.app.vault.create(
      quoting,
      `# Exigences du lot 02\n\n\`\`\`pm-req\n${DEMO_REQUIREMENTS.map((one) => one.id).join('\n')}\n\`\`\`\n`
    )
  }
  await keep()

  // The library: the specification, and a document in English to translate.
  const report = await plugin.library.pour(
    [
      {
        kind: 'bytes',
        name: 'CCTP Lot 02 Gros oeuvre indice B.docx',
        bytes: buildDocx(cctpDocument()),
        title: 'CCTP Lot 02 — Gros œuvre',
        classification: { category: 'CCTP' }
      },
      {
        kind: 'bytes',
        name: 'Statement of work site maintenance.docx',
        bytes: buildDocx(englishSow()),
        title: 'Statement of work — Site maintenance'
      }
    ],
    { projects: [b12.filePath], move: false, today: day, folder: LIBRARY_FOLDER }
  )
  manifest.library.push(...report.added)

  // What to try, and where.
  const guide = normalizePath(`${root}/${t('demo.guideName')}.md`)
  if (!plugin.app.vault.getAbstractFileByPath(guide)) await plugin.app.vault.create(guide, demoGuide())
  await keep()

  plugin.index.build()
  new Notice(t('demo.created'), 10000)
  const file = plugin.app.vault.getAbstractFileByPath(guide)
  if (file instanceof TFile) await plugin.app.workspace.getLeaf('tab').openFile(file)
  await plugin.router.openScope({ kind: 'project', path: b12.filePath })
}

/** Takes away everything the demonstration wrote, and nothing else. */
export async function removeDemo(plugin: PMPlugin): Promise<void> {
  const manifest = plugin.settings.demo
  if (!manifest) {
    new Notice(t('demo.none'))
    return
  }
  for (const path of manifest.projects) {
    const project = await plugin.store.loadProjectByPath(path)
    if (project) await plugin.store.deleteProject(project)
  }
  const trash = async (path: string): Promise<void> => {
    const file = plugin.app.vault.getAbstractFileByPath(path)
    if (file) await plugin.app.fileManager.trashFile(file)
  }
  for (const path of [...manifest.contacts, ...manifest.requirements, ...manifest.notes]) await trash(path)
  for (const doc of plugin.library.docs()) {
    if (manifest.library.includes(doc.record)) await plugin.library.remove(doc)
  }
  plugin.settings.demo = undefined
  await plugin.saveSettings()
  plugin.index.build()
  new Notice(t('demo.removed'))
}
