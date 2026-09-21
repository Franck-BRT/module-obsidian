import { describe, expect, it } from 'vitest'
import { isSettingsPath, readSettingsPath, writeSettingsPath } from './settingsPath'

function root() {
  return { projectsFolder: 'Projects', requirements: { folder: 'Requirements', idWidth: 4 }, zones: [] as unknown[] }
}

describe('isSettingsPath', () => {
  it('tells a path from a plain key', () => {
    expect(isSettingsPath('requirements.folder')).toBe(true)
    expect(isSettingsPath('projectsFolder')).toBe(false)
  })
})

describe('readSettingsPath', () => {
  it('reads a setting one level down', () => {
    expect(readSettingsPath(root(), 'requirements.folder')).toEqual({ found: true, value: 'Requirements' })
  })

  it('says it found nothing rather than returning undefined as a value', () => {
    expect(readSettingsPath(root(), 'requirements.missing').found).toBe(false)
    expect(readSettingsPath(root(), 'nowhere.folder').found).toBe(false)
  })

  it('refuses to walk into an array, which is not a group of settings', () => {
    expect(readSettingsPath(root(), 'zones.0').found).toBe(false)
  })
})

describe('writeSettingsPath', () => {
  it('writes where the path leads', () => {
    const settings = root()
    expect(writeSettingsPath(settings, 'requirements.folder', 'Exigences')).toBe(true)
    expect(settings.requirements.folder).toBe('Exigences')
  })

  it('never invents a setting the path only suggests', () => {
    const settings = root()
    expect(writeSettingsPath(settings, 'requirements.unknown', 'x')).toBe(false)
    expect(Object.hasOwn(settings.requirements, 'unknown')).toBe(false)
  })

  it('never invents the group either', () => {
    const settings = root()
    expect(writeSettingsPath(settings, 'nothing.here', 'x')).toBe(false)
    expect(Object.hasOwn(settings, 'nothing')).toBe(false)
  })
})
