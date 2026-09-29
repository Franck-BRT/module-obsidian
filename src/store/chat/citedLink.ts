import { parseLinktext, TFile, type App } from 'obsidian'
import { fold } from '../library/libraryDoc'

/**
 * The file a link in a reply cites, however the model wrote it.
 *
 * A model copying a link it was given does not always copy it exactly: the folder dropped,
 * the extension added or left out, an accent written another way, the link's text taken
 * for its target. Obsidian, asked to open a link it cannot resolve, makes a note of that
 * name — a new, empty note where the reader wanted the source. So the link is resolved
 * here first, as Obsidian would, then among the sources the conversation actually looked
 * through; one found nowhere is said to be missing, and nothing is made.
 */
export function citedFile(
  app: App,
  raw: string,
  sourcePath: string,
  consulted: string[]
): { file: TFile; subpath: string } | null {
  let text = raw.trim()
  if (/%[0-9a-f]{2}/i.test(text)) {
    try {
      text = decodeURIComponent(text)
    } catch {
      // Not encoded after all: taken as it is.
    }
  }
  text = text
    .replace(/^\[\[|\]\]$/g, '')
    .split('|')[0]
    .trim()
  const { path, subpath } = parseLinktext(text)
  if (!path) return null

  const tries = new Set([path, path.normalize('NFC'), path.normalize('NFD'), path.replace(/\.md$/i, '')])
  for (const each of tries) {
    const found = app.metadataCache.getFirstLinkpathDest(each, sourcePath)
    if (found) return { file: found, subpath }
    const direct = app.vault.getAbstractFileByPath(each)
    if (direct instanceof TFile) return { file: direct, subpath }
  }

  // Among what the conversation looked through: by its whole path, or by its name alone.
  const key = (value: string): string => fold(value.normalize('NFC')).replace(/\.md$/i, '').replace(/\s+/g, ' ').trim()
  const wanted = key(path)
  const name = wanted.slice(wanted.lastIndexOf('/') + 1)
  const match =
    consulted.find((each) => key(each) === wanted) ??
    consulted.find((each) => key(each).endsWith(`/${wanted}`)) ??
    consulted.find((each) => {
      const own = key(each)
      return own.slice(own.lastIndexOf('/') + 1).replace(/\.[a-z0-9]+$/i, '') === name.replace(/\.[a-z0-9]+$/i, '')
    })
  const file = match ? app.vault.getAbstractFileByPath(match) : null
  return file instanceof TFile ? { file, subpath } : null
}
