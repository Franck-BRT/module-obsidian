import { describe, expect, it, vi } from 'vitest'
import { TFile } from 'obsidian'
import type { App } from 'obsidian'
import { MailCache } from './MailBox'

/** An `.eml` is text, so a fixture needs no compound file to be a real message. */
const EML = [
  'From: Marie <m@bati.fr>',
  'Subject: Devis toiture',
  'Date: Tue, 7 Apr 2026 09:00:00 +0200',
  '',
  'Bonjour.'
].join('\r\n')

function fakeFile(path: string, mtime: number, size: number): TFile {
  const file = new TFile()
  file.path = path
  file.name = path.slice(path.lastIndexOf('/') + 1)
  file.extension = 'eml'
  file.stat = { ctime: 0, mtime, size }
  return file
}

function fakeApp(bytes: Uint8Array): { app: App; reads: () => number } {
  const readBinary = vi.fn<() => Promise<ArrayBuffer>>(() => Promise.resolve(bytes.buffer as ArrayBuffer))
  return { app: { vault: { readBinary } } as unknown as App, reads: () => readBinary.mock.calls.length }
}

describe('the mailbox cache', () => {
  const bytes = new TextEncoder().encode(EML)

  it('reads a message once and answers from memory after that', async () => {
    const cache = new MailCache()
    const { app, reads } = fakeApp(bytes)
    const file = fakeFile('P/_mail/a.eml', 1000, bytes.length)

    const first = await cache.read(app, file)
    const second = await cache.read(app, file)

    expect(first.mail?.subject).toBe('Devis toiture')
    expect(second).toBe(first)
    // The whole point: parsing a .msg is not free, and the list redraws on every keystroke.
    expect(reads()).toBe(1)
  })

  it('reads again when the file has changed underneath it', async () => {
    const cache = new MailCache()
    const { app, reads } = fakeApp(bytes)

    await cache.read(app, fakeFile('P/_mail/a.eml', 1000, bytes.length))
    await cache.read(app, fakeFile('P/_mail/a.eml', 2000, bytes.length))
    expect(reads()).toBe(2)

    // Same moment, different size: a rewrite within the same second is still a rewrite.
    await cache.read(app, fakeFile('P/_mail/a.eml', 2000, bytes.length + 1))
    expect(reads()).toBe(3)
  })

  it('knows nothing about a file it has not read', () => {
    expect(new MailCache().peek(fakeFile('P/_mail/a.eml', 1, 1))).toBeNull()
  })

  it('keeps an unreadable file as a row rather than dropping it', async () => {
    const cache = new MailCache()
    const { app } = fakeApp(new TextEncoder().encode('this is not a message'))
    const entry = await cache.read(app, fakeFile('P/_mail/junk.eml', 1, 21))
    expect(entry.mail).toBeNull()
    expect(entry.name).toBe('junk.eml')
  })

  it('lets go of mail the vault no longer has', async () => {
    const cache = new MailCache()
    const { app } = fakeApp(bytes)
    await cache.read(app, fakeFile('P/_mail/a.eml', 1, bytes.length))
    await cache.read(app, fakeFile('P/_mail/b.eml', 1, bytes.length))
    expect(cache.size).toBe(2)

    cache.prune(['P/_mail/a.eml'])
    expect(cache.size).toBe(1)
    expect(cache.peek(fakeFile('P/_mail/b.eml', 1, bytes.length))).toBeNull()
  })
})
