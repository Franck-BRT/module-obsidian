import type { PMSettings } from '../types'

/**
 * The folders this plugin's settings have lived in, newest first.
 *
 * Obsidian keeps a plugin's `data.json` in a folder named after its id, so renaming the
 * id leaves the settings behind in the old folder. Reading them back is what makes a
 * rename cost the user nothing.
 *
 * Upstream's `project-manager` is deliberately absent: it is a different plugin that may
 * still be installed and running, and inheriting its configuration without being asked
 * would be a surprise. Copying that one over stays a documented manual step.
 */
export const FORMER_PLUGIN_IDS = ['black-documents', 'dotpm-fr'] as const

export interface FormerSettings {
  /** The folder they were found in, to tell the user where they came from. */
  folder: string
  settings: Partial<PMSettings>
}

/**
 * Finds the settings left behind by an earlier name of this plugin.
 *
 * `read` resolves to null for a file that is not there. A folder that holds something
 * unreadable is skipped rather than fatal: a corrupt `data.json` should cost the user
 * their settings, not their plugin.
 */
export async function readFormerSettings(
  read: (path: string) => Promise<string | null>,
  configDir: string,
  formerIds: readonly string[] = FORMER_PLUGIN_IDS
): Promise<FormerSettings | null> {
  for (const folder of formerIds) {
    const raw = await read(`${configDir}/plugins/${folder}/data.json`)
    if (raw === null) continue
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      continue
    }
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return { folder, settings: parsed }
    }
  }
  return null
}
