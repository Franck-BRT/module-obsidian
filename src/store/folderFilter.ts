/**
 * A library's folder filter — the notes library's, the document library's —: every folder,
 * the library's root alone, or one folder with the folders it holds.
 */

/** Stands for what is at the library's root — in no folder of its own — in a folder filter. */
export const AT_ROOT = ':root'

/** Whether something in a folder, by its path under the library's, answers a folder filter. */
export function inFolder(subfolder: string, wanted: string | undefined): boolean {
  if (!wanted) return true
  if (wanted === AT_ROOT) return !subfolder
  return subfolder === wanted || subfolder.startsWith(`${wanted}/`)
}
