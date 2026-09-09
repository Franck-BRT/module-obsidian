import { normalizePath, Notice, TFile } from 'obsidian'
import type { App } from 'obsidian'
import { makeCollection, type Collection } from '../types'
import { t } from '../i18n'
import { sanitizeFileName } from '../utils'
import { refLink, refToId } from './refs'
import { resolveVaultLink } from './vaultFs'
import type { VaultIndex } from './VaultIndex'
import { hydrateCollection } from './YamlHydrator'
import { parseFrontmatter, projectBodyRemainder, COLLECTION_FRONTMATTER_KEY } from './YamlParser'
import { COLLECTION_FRONTMATTER_KEYS, foreignFrontmatter, serializeCollection, type RefWriter } from './YamlSerializer'

/**
 * Reads and writes collection notes.
 *
 * Deliberately thin next to ProjectStore: a collection owns no tasks and no folder, so
 * there is nothing to keep in sync, no save queue and no dirty tracking. Working out
 * what a collection currently holds does not come through here at all — the definition
 * is indexed from frontmatter, so the views resolve members without a note read.
 */
export class CollectionStore {
  constructor(
    private app: App,
    private index: VaultIndex
  ) {}

  private refsFor(sourcePath: string): RefWriter {
    const link = (targetPath: string, title: string): string => refLink(this.app, targetPath, title, sourcePath)
    return {
      link,
      dependency: (taskId) => {
        const ref = this.index.task(taskId)
        return ref ? link(ref.path, ref.title) : null
      }
    }
  }

  collectionFilePath(title: string, folder: string): string {
    const name = sanitizeFileName(title) || 'Collection'
    return normalizePath(folder ? `${folder}/${name}.md` : `${name}.md`)
  }

  async create(title: string, folder: string): Promise<Collection | null> {
    const path = this.collectionFilePath(title, folder)
    if (this.app.vault.getAbstractFileByPath(path)) {
      new Notice(t('field.nameTaken'))
      return null
    }
    const collection = makeCollection(title, path)
    await this.write(collection)
    return collection
  }

  async load(path: string): Promise<Collection | null> {
    const file = this.app.vault.getAbstractFileByPath(normalizePath(path))
    if (!(file instanceof TFile)) return null
    const { frontmatter, body } = parseFrontmatter(await this.app.vault.cachedRead(file))
    if (!frontmatter || frontmatter[COLLECTION_FRONTMATTER_KEY] !== true) return null
    return hydrateCollection(frontmatter, body, file.path, file.basename, {
      taskId: (raw) => refToId(this.app, raw, file.path),
      projectPath: (raw) => resolveVaultLink(this.app, raw, file.path) ?? null
    })
  }

  /** Reads, applies, writes. Nothing else touches these notes, so no queue is needed. */
  async update(path: string, change: (collection: Collection) => Collection): Promise<Collection | null> {
    const current = await this.load(path)
    if (!current) return null
    const next = { ...change(current), updatedAt: new Date().toISOString() }
    await this.write(next)
    return next
  }

  private async write(collection: Collection): Promise<void> {
    const refs = this.refsFor(collection.filePath)
    const file = this.app.vault.getAbstractFileByPath(collection.filePath)
    if (file instanceof TFile) {
      await this.app.vault.process(file, (content) => {
        const { frontmatter, body } = parseFrontmatter(content)
        return serializeCollection(
          collection,
          refs,
          foreignFrontmatter(frontmatter, COLLECTION_FRONTMATTER_KEYS),
          // Same reason as a project note: whatever the user typed in here is theirs.
          projectBodyRemainder(body, collection.icon, collection.title, collection.description)
        )
      })
      return
    }
    const folder = collection.filePath.slice(0, collection.filePath.lastIndexOf('/'))
    if (folder && !this.app.vault.getAbstractFileByPath(folder)) {
      await this.app.vault.createFolder(folder).catch(() => {})
    }
    await this.app.vault.create(collection.filePath, serializeCollection(collection, refs))
  }
}
