import { linkPath, stringList } from '../library/libraryDoc'

/**
 * The projects a note — minutes, meeting notes — belongs to, for the tickets it calls for
 * to go into: those its properties name, else the one whose own folder holds it.
 *
 * A folder counts only when it is one project's alone: projects kept side by side in one
 * folder say nothing of which a note beside them is about.
 */
export function noteProjects(
  notePath: string,
  frontmatter: Record<string, unknown> | undefined,
  refs: { path: string; template?: boolean }[],
  /** The note a link in the properties leads to, by its path; null when it leads nowhere. */
  resolve: (link: string) => string | null
): string[] {
  const known = new Set(refs.filter((ref) => !ref.template).map((ref) => ref.path))
  const named = [
    ...stringList(frontmatter?.projects),
    ...stringList(frontmatter?.project),
    ...stringList(frontmatter?.projet)
  ]
    .map((raw) => resolve(linkPath(raw)))
    .filter((path): path is string => !!path && known.has(path))
  if (named.length) return [...new Set(named)]

  const folderOf = (path: string): string => path.slice(0, Math.max(0, path.lastIndexOf('/')))
  const folders = new Map<string, number>()
  for (const path of known) folders.set(folderOf(path), (folders.get(folderOf(path)) ?? 0) + 1)
  const holding = [...known]
    .filter((path) => {
      const folder = folderOf(path)
      return !!folder && folders.get(folder) === 1 && notePath.startsWith(`${folder}/`)
    })
    .sort((a, b) => folderOf(b).length - folderOf(a).length)
  return holding.slice(0, 1)
}
