import { normalizePath, TFile, type App } from 'obsidian'
import type PMPlugin from '../../main'
import {
  AGENDA_BLOCKS,
  blockName,
  readTemplate,
  type AgendaBlock,
  type AgendaTemplate
} from '../../store/agenda/agendaTemplate'
import { parseFrontmatter } from '../../store/YamlParser'
import { ensureFolder } from '../../store/vaultFs'
import { contactFileName } from '../../store/contacts'
import { currentLocale, t } from '../../i18n'
import { defaultTemplates, templateNote } from './agendaDefaults'

/**
 * The agenda templates, kept as notes in a folder of their own: the reader edits them as
 * any note, adds some, throws some away. The shipped ones are written there the first
 * time a template is needed, and again only when asked.
 */

/** The folder the templates live in. */
export function agendaFolder(plugin: PMPlugin): string {
  return normalizePath(plugin.settings.agendaFolder.trim() || t('agenda.defaultFolder'))
}

function templateFiles(app: App, folder: string): TFile[] {
  const prefix = `${folder}/`
  return app.vault
    .getMarkdownFiles()
    .filter((file) => file.path.startsWith(prefix))
    .sort((a, b) => a.basename.localeCompare(b.basename))
}

/** The templates, by name; the shipped ones written first if they never were. */
export async function listTemplates(plugin: PMPlugin): Promise<AgendaTemplate[]> {
  await seedTemplates(plugin)
  const app = plugin.app
  const out: AgendaTemplate[] = []
  for (const file of templateFiles(app, agendaFolder(plugin))) {
    const { frontmatter, body } = parseFrontmatter(await app.vault.cachedRead(file))
    out.push(readTemplate(file.path, file.basename, frontmatter, body))
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

/** Writes the shipped templates once, the first time any is needed. */
async function seedTemplates(plugin: PMPlugin): Promise<void> {
  if (plugin.settings.agendaSeeded) return
  await restoreTemplates(plugin)
  plugin.settings.agendaSeeded = true
  await plugin.saveSettings()
}

/** Writes back the shipped templates missing from the folder; how many were. */
export async function restoreTemplates(plugin: PMPlugin): Promise<number> {
  const app = plugin.app
  const folder = agendaFolder(plugin)
  await ensureFolder(app, folder)
  let written = 0
  for (const template of defaultTemplates()) {
    const path = normalizePath(`${folder}/${template.file}.md`)
    if (app.vault.getAbstractFileByPath(path)) continue
    await app.vault.create(path, templateNote(template))
    written++
  }
  return written
}

/** A free name in the folder: `name`, else `name 2`, `name 3`… */
function freePath(app: App, folder: string, name: string): string {
  const base = contactFileName(name) || t('agenda.newName')
  let path = normalizePath(`${folder}/${base}.md`)
  for (let n = 2; app.vault.getAbstractFileByPath(path); n++) path = normalizePath(`${folder}/${base} ${n}.md`)
  return path
}

/** A new template's text: a heading, the usual lines, and every block it may use, in a comment. */
function skeleton(name: string): string {
  const french = currentLocale() === 'fr'
  const b = (block: AgendaBlock): string => `{{${blockName(block, french)}}}`
  return [
    `# ${name} — ${b('project')}`,
    '',
    `**${t('agenda.dateLabel')}** ${b('date')} ${b('time')}`,
    `**${t('agenda.attendeesLabel')}**`,
    b('attendees'),
    '',
    `## 1. ${t('agenda.firstItem')}`,
    '- ',
    '',
    `%% ${t('agenda.blocksHelp')} ${AGENDA_BLOCKS.map(([, en]) => b(en)).join(' ')} %%`,
    ''
  ].join('\n')
}

/** A new template, with a skeleton and the blocks it may use; its note's path. */
export async function newTemplate(plugin: PMPlugin, name: string): Promise<string> {
  const app = plugin.app
  const folder = agendaFolder(plugin)
  await ensureFolder(app, folder)
  const path = freePath(app, folder, name)
  const body = skeleton(name)
  await app.vault.create(path, templateNote({ name, description: '', horizon: 14, body }))
  return path
}

/** A copy of a template, under a name of its own; its note's path. */
export async function duplicateTemplate(plugin: PMPlugin, template: AgendaTemplate): Promise<string> {
  const app = plugin.app
  const file = app.vault.getAbstractFileByPath(template.path)
  if (!(file instanceof TFile)) return ''
  const name = t('agenda.copyName', { name: template.name })
  const path = freePath(app, agendaFolder(plugin), name)
  const text = await app.vault.read(file)
  const renamed = text.replace(/^name:.*$/m, `name: ${JSON.stringify(name)}`)
  await app.vault.create(path, renamed)
  return path
}

/** A template thrown away, to the trash. */
export async function deleteTemplate(plugin: PMPlugin, template: AgendaTemplate): Promise<void> {
  const file = plugin.app.vault.getAbstractFileByPath(template.path)
  if (file instanceof TFile) await plugin.app.fileManager.trashFile(file)
}
