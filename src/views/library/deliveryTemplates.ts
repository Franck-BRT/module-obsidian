import { normalizePath, TFile, type App } from 'obsidian'
import type PMPlugin from '../../main'
import { defaultDeliveryTemplate, type DeliveryWords } from '../../store/delivery'
import { buildDocx } from '../../store/docx'
import { markdownBlocks } from '../../store/markdownBlocks'
import { openDocumentFile } from '../../store/DocumentStore'
import { ensureFolder, folderOf } from '../../store/vaultFs'
import { formatDate } from '../../dates'
import { currentLocale, t } from '../../i18n'
import { docStateLabel } from './docStateLabel'

/**
 * The delivery note's two templates: the note its content is written from, and the Word
 * document of the reader's own — letterhead, logo — its Word is filled from. Neither is
 * needed: without them, the plugin's own template and layout are used.
 */

/** The words the delivery note is written with, in the reader's language. */
export function deliveryWords(): DeliveryWords {
  return {
    title: t('delivery.title'),
    numberDate: (number, date) => t('delivery.numberDate', { number, date }),
    project: t('delivery.project'),
    sender: t('delivery.sender'),
    recipient: t('delivery.recipient'),
    reference: t('delivery.reference'),
    documentTitle: t('delivery.documentTitle'),
    state: t('delivery.state'),
    version: t('delivery.version'),
    countLabel: t('delivery.countLabel'),
    stateLabel: docStateLabel,
    day: formatDate,
    signatures: t('delivery.signatures'),
    sentBy: t('delivery.sentBy'),
    receivedBy: t('delivery.receivedBy'),
    signHere: t('delivery.signHere'),
    help: [t('delivery.help.what'), t('delivery.help.rows'), t('delivery.help.word'), t('delivery.help.fields')]
  }
}

/** The plugin's own template, in the reader's language and with its field names. */
export function shippedDeliveryTemplate(): string {
  return defaultDeliveryTemplate(deliveryWords(), currentLocale() === 'en')
}

function templatePath(name: string): string {
  return normalizePath(`${t('delivery.templatesFolder')}/${name}`)
}

function fileAt(app: App, path: string): TFile | null {
  const file = path.trim() ? app.vault.getAbstractFileByPath(normalizePath(path.trim())) : null
  return file instanceof TFile ? file : null
}

/** The reader's template note, when the one set is there. */
export function deliveryTemplateFile(plugin: PMPlugin): TFile | null {
  return fileAt(plugin.app, plugin.settings.deliveryTemplate)
}

/** The reader's Word template, when the one set is there. */
export function deliveryWordFile(plugin: PMPlugin): TFile | null {
  return fileAt(plugin.app, plugin.settings.deliveryWordTemplate)
}

/** The template the note is written from: the reader's, else the plugin's. */
export async function deliveryTemplateText(plugin: PMPlugin): Promise<string> {
  const file = deliveryTemplateFile(plugin)
  return file ? plugin.app.vault.cachedRead(file) : shippedDeliveryTemplate()
}

/** The reader's Word template's bytes; null when none is set or it is not there. */
export async function deliveryWordBytes(plugin: PMPlugin): Promise<Uint8Array | null> {
  const file = deliveryWordFile(plugin)
  return file ? new Uint8Array(await plugin.app.vault.readBinary(file)) : null
}

async function remember(plugin: PMPlugin, key: 'deliveryTemplate' | 'deliveryWordTemplate', path: string) {
  plugin.settings[key] = path
  await plugin.saveSettings()
}

/** The reader's template note: the one set, else made from the plugin's where it was set or in Templates. */
export async function ensureDeliveryTemplate(plugin: PMPlugin): Promise<TFile> {
  const found = deliveryTemplateFile(plugin)
  if (found) return found
  const app = plugin.app
  const wanted = plugin.settings.deliveryTemplate.trim()
  const path = normalizePath(
    wanted ? (wanted.endsWith('.md') ? wanted : `${wanted}.md`) : templatePath(`${t('delivery.title')}.md`)
  )
  await ensureFolder(app, folderOf(path))
  const existing = app.vault.getAbstractFileByPath(path)
  const file = existing instanceof TFile ? existing : await app.vault.create(path, shippedDeliveryTemplate())
  await remember(plugin, 'deliveryTemplate', file.path)
  return file
}

/**
 * The reader's Word template: the one set, else made from the template note — its
 * fields left to fill — for them to dress in Word with their letterhead and logo.
 */
export async function ensureDeliveryWord(plugin: PMPlugin): Promise<TFile> {
  const found = deliveryWordFile(plugin)
  if (found) return found
  const app = plugin.app
  const wanted = plugin.settings.deliveryWordTemplate.trim()
  const path = normalizePath(
    wanted ? (wanted.endsWith('.docx') ? wanted : `${wanted}.docx`) : templatePath(`${t('delivery.title')}.docx`)
  )
  await ensureFolder(app, folderOf(path))
  const existing = app.vault.getAbstractFileByPath(path)
  let file: TFile
  if (existing instanceof TFile) file = existing
  else {
    const bytes = buildDocx({ title: t('delivery.title'), blocks: markdownBlocks(await deliveryTemplateText(plugin)) })
    file = await app.vault.createBinary(path, bytes.slice().buffer)
  }
  await remember(plugin, 'deliveryWordTemplate', file.path)
  return file
}

/** A template opened to be changed: the note in a tab, the Word document in Word. */
export async function openTemplate(plugin: PMPlugin, file: TFile): Promise<boolean> {
  return openDocumentFile(plugin.app, file)
}
