import { normalizePath, type App } from 'obsidian'
import { isChatNote } from '../chat/chatNote'
import type { DocLibrary } from '../library/DocLibrary'
import type { DocTextIndex } from '../library/DocTextIndex'
import { isLibraryDoc, linkPath, stringList } from '../library/libraryDoc'
import { noteBody } from '../notes/NoteLibrary'
import { FRONTMATTER_KEY, TASK_FRONTMATTER_KEY } from '../YamlParser'
import { propertyLines } from './ragChunk'
import type { RagKind, RagSourceSpec } from './RagIndex'

/**
 * What the vault search looks through: every note of the vault — notes, projects, tickets,
 * conversations — and every document of the library by what it says, less the folders the
 * reader left out and those no one reads (hidden ones, the plugin's own workings).
 */

export interface SourceDeps {
  app: App
  library: DocLibrary
  texts: DocTextIndex
  /** Folders left out, by their paths in the vault. */
  excluded: string[]
  /** How a document's filing is said to the model. */
  words: { category: string; lot: string; issuer: string; tags: string }
}

/** Folders left out, one a line, as vault paths. */
export function excludedFolders(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^\/+|\/+$/g, ''))
    .filter(Boolean)
    .map((line) => normalizePath(line))
}

/** Whether a path is left out: in a folder left out, or in a hidden one. */
export function leftOut(path: string, excluded: string[]): boolean {
  if (path.split('/').some((part) => part.startsWith('.'))) return true
  return excluded.some((folder) => path === folder || path.startsWith(`${folder}/`))
}

function kindOf(frontmatter: Record<string, unknown> | undefined): RagKind {
  if (frontmatter?.[FRONTMATTER_KEY] === true) return 'project'
  if (frontmatter?.[TASK_FRONTMATTER_KEY] === true) return 'ticket'
  if (isChatNote(frontmatter)) return 'chat'
  return 'note'
}

/** The sources to index, the library's documents first: they are what a search most often wants. */
export function vaultSources(deps: SourceDeps): RagSourceSpec[] {
  const { app, library, texts, excluded, words } = deps
  const docs = library.docs().filter((doc) => doc.file && !leftOut(doc.file, excluded))
  const docFiles = new Set(docs.map((doc) => doc.file))
  const sources: RagSourceSpec[] = []

  for (const doc of docs) {
    const entry = texts.entry(doc)
    const filing = [
      doc.category ? `${words.category}: ${doc.category}` : '',
      doc.lot ? `${words.lot}: ${doc.lot}` : '',
      doc.issuer ? `${words.issuer}: ${doc.issuer}` : '',
      doc.tags.length ? `${words.tags}: ${doc.tags.join(', ')}` : ''
    ]
      .filter(Boolean)
      .join('\n')
    sources.push({
      path: doc.file,
      title: doc.title,
      kind: 'document',
      // What it says, and how it is filed: either changed, it is read again.
      key: [doc.hash, entry?.state ?? 'none', entry?.mtime ?? 0, doc.title, filing].join('|'),
      projects: doc.projects,
      read: async () => [filing, entry?.text ?? ''].filter(Boolean).join('\n\n')
    })
  }

  for (const file of app.vault.getMarkdownFiles()) {
    if (leftOut(file.path, excluded) || docFiles.has(file.path)) continue
    const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter
    // A library record stands for its document, which is looked through by what it says.
    if (isLibraryDoc(frontmatter)) continue
    const kind = kindOf(frontmatter)
    const title =
      typeof frontmatter?.title === 'string' && frontmatter.title.trim() ? frontmatter.title.trim() : file.basename
    const projects = [...stringList(frontmatter?.projects), ...stringList(frontmatter?.project ?? frontmatter?.projet)]
      .map((raw) => app.metadataCache.getFirstLinkpathDest(linkPath(raw), file.path)?.path)
      .filter((path): path is string => !!path)
    sources.push({
      path: file.path,
      title,
      kind,
      key: `${file.stat.mtime}|${file.stat.size}`,
      projects: [...new Set(projects)],
      read: async () => {
        const content = await app.vault.cachedRead(file)
        return [propertyLines(frontmatter), noteBody(content)].filter(Boolean).join('\n\n')
      }
    })
  }
  return sources
}

/** Whether a source belongs to a project: said so, or in the project's own folder. */
export function inProject(source: { path: string; projects: string[] }, project: string): boolean {
  if (source.projects.includes(project)) return true
  const folder = project.slice(0, Math.max(0, project.lastIndexOf('/')))
  return !!folder && source.path.startsWith(`${folder}/`)
}
