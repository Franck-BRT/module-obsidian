import { describe, expect, it } from 'vitest'
import { readFormerSettings } from './formerSettings'

// Not the real `.obsidian`: the folder is the caller's to name, and a vault can rename it.
const CONFIG = '.config'

function reader(files: Record<string, string>) {
  const seen: string[] = []
  const read = async (path: string): Promise<string | null> => {
    seen.push(path)
    return files[path] ?? null
  }
  return { read, seen }
}

describe('taking over the settings of an earlier plugin folder', () => {
  it('reads the folder the plugin last went by', async () => {
    const { read } = reader({ '.config/plugins/black-documents/data.json': '{"language":"fr"}' })
    const found = await readFormerSettings(read, CONFIG)
    expect(found?.folder).toBe('black-documents')
    expect(found?.settings.language).toBe('fr')
  })

  it('prefers the most recent folder when several are left over', async () => {
    const { read } = reader({
      '.config/plugins/black-documents/data.json': '{"language":"fr"}',
      '.config/plugins/dotpm-fr/data.json': '{"language":"en"}'
    })
    expect((await readFormerSettings(read, CONFIG))?.folder).toBe('black-documents')
  })

  it('falls through to an older folder when the newer one is gone', async () => {
    const { read } = reader({ '.config/plugins/dotpm-fr/data.json': '{"language":"en"}' })
    expect((await readFormerSettings(read, CONFIG))?.folder).toBe('dotpm-fr')
  })

  it('skips a folder whose settings cannot be parsed rather than failing the load', async () => {
    const { read } = reader({
      '.config/plugins/black-documents/data.json': 'not json {',
      '.config/plugins/dotpm-fr/data.json': '{"language":"en"}'
    })
    expect((await readFormerSettings(read, CONFIG))?.folder).toBe('dotpm-fr')
  })

  it('rejects a data.json that is not an object', async () => {
    const { read } = reader({ '.config/plugins/black-documents/data.json': '[1, 2]' })
    expect(await readFormerSettings(read, CONFIG)).toBeNull()
  })

  it('finds nothing when no former folder is left', async () => {
    const { read } = reader({})
    expect(await readFormerSettings(read, CONFIG)).toBeNull()
  })

  it('honours a vault whose config folder was renamed', async () => {
    const { read, seen } = reader({})
    await readFormerSettings(read, '.my-config')
    expect(seen[0]).toBe('.my-config/plugins/black-documents/data.json')
  })

  it('does not look in upstream’s folder, which may be another live plugin', async () => {
    const { read, seen } = reader({})
    await readFormerSettings(read, CONFIG)
    expect(seen.some((path) => path.includes('project-manager'))).toBe(false)
  })
})
