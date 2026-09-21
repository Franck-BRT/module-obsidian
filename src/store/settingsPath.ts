/**
 * Settings addressed by a path, for the groups that have an object of their own.
 *
 * Obsidian's own resolver reads a flat key off the settings object, which is right for
 * every setting that is one — and wrong for `requirements.folder`. Rather than flattening
 * a group to suit the control, the path is resolved here, and only a path that leads
 * somewhere real is resolved at all: a key naming a group that does not exist must fall
 * back to the flat reader rather than quietly inventing the group.
 */

export function isSettingsPath(key: string): boolean {
  return key.includes('.')
}

function holderOf(
  root: Record<string, unknown>,
  key: string
): { holder: Record<string, unknown>; leaf: string } | null {
  const parts = key.split('.')
  const leaf = parts.pop()
  if (!leaf || parts.length === 0) return null
  let holder: Record<string, unknown> = root
  for (const part of parts) {
    const next = holder[part]
    if (typeof next !== 'object' || next === null || Array.isArray(next)) return null
    holder = next as Record<string, unknown>
  }
  return { holder, leaf }
}

export function readSettingsPath(root: Record<string, unknown>, key: string): { found: boolean; value: unknown } {
  const at = holderOf(root, key)
  if (!at || !Object.hasOwn(at.holder, at.leaf)) return { found: false, value: undefined }
  return { found: true, value: at.holder[at.leaf] }
}

/** Writes, and says whether it could. A path that leads nowhere is never created. */
export function writeSettingsPath(root: Record<string, unknown>, key: string, value: unknown): boolean {
  const at = holderOf(root, key)
  if (!at || !Object.hasOwn(at.holder, at.leaf)) return false
  at.holder[at.leaf] = value
  return true
}
