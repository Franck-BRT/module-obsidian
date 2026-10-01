import { describe, expect, it } from 'vitest'
import { DEFAULT_OCR_SETTINGS } from '../../types'
import { ScanProgress, type ScanProgressEntry } from './scanProgress'

function disk() {
  const files = new Map<string, string>()
  return {
    files,
    read: (name: string) => Promise.resolve(files.get(name) ?? null),
    write: (name: string, data: string) => {
      files.set(name, data)
      return Promise.resolve()
    }
  }
}

const entry = (key: string, parts: string[]): ScanProgressEntry => ({
  key,
  title: `Doc ${key}`,
  file: `L/_files/${key}.pdf`,
  mtime: 10,
  parts,
  total: 19,
  options: DEFAULT_OCR_SETTINGS,
  again: true
})

describe('the readings cut short', () => {
  it('keeps the pages read so far on disk, found again after a restart, and forgets one that ended', async () => {
    const storage = disk()
    const progress = new ScanProgress(storage)
    await progress.keep(entry('a', ['p1']))
    await progress.keep(entry('a', ['p1', 'p2']))
    await progress.keep(entry('b', ['p1']))
    const again = new ScanProgress(storage)
    await again.ready()
    expect(again.list().map((one) => [one.key, one.parts.length])).toEqual([
      ['a', 2],
      ['b', 1]
    ])
    await again.forget('a')
    expect(again.get('a')).toBeNull()
    expect(again.list()).toHaveLength(1)
  })

  it('goes on only for the file as it was: one changed since, or another, is read anew', async () => {
    const progress = new ScanProgress(disk())
    await progress.keep(entry('a', ['p1', 'p2']))
    expect(progress.resumeFrom('a', 'L/_files/a.pdf', 10)).toEqual(['p1', 'p2'])
    expect(progress.resumeFrom('a', 'L/_files/a.pdf', 11)).toEqual([])
    expect(progress.resumeFrom('a', 'L/_files/autre.pdf', 10)).toEqual([])
    expect(progress.resumeFrom('z', 'L/_files/z.pdf', 10)).toEqual([])
  })

  it('starts empty when what is on disk does not read', async () => {
    const storage = disk()
    storage.files.set('scan-progress.json', '{oops')
    const progress = new ScanProgress(storage)
    await progress.ready()
    expect(progress.list()).toEqual([])
  })
})
