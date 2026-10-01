import { describe, expect, it } from 'vitest'
import { ScanQueue, ScanStopped, type ScanJob } from './ScanQueue'

/** A job that reads its pages when told to, so the queue can be seen between them. */
function job(key: string, pages: number, gate: { open: () => Promise<void> }, fail?: string): ScanJob {
  return {
    key,
    title: `Doc ${key}`,
    run: async (progress, stopped) => {
      for (let page = 1; page <= pages; page++) {
        if (stopped()) throw new ScanStopped()
        progress(page, pages)
        await gate.open()
      }
      if (fail) throw new Error(fail)
    }
  }
}

/** Opens one page at a time, on demand. */
function gate() {
  const waiting: (() => void)[] = []
  return {
    open: () => new Promise<void>((resolve) => waiting.push(resolve)),
    next: async () => {
      while (!waiting.length) await Promise.resolve()
      waiting.shift()?.()
      await Promise.resolve()
    }
  }
}

describe('the scans being read', () => {
  it('reads one document at a time, says its page and since when, and the ones waiting', async () => {
    let clock = 1000
    const queue = new ScanQueue(() => clock)
    const pages = gate()
    const done = queue.add([job('a', 2, pages), job('b', 1, pages)])
    await Promise.resolve()
    expect(queue.current).toMatchObject({ key: 'a', page: 1, total: 2, since: 1000 })
    expect(queue.waiting.map((one) => one.key)).toEqual(['b'])
    expect(queue.stateOf('a')).toBe('reading')
    expect(queue.stateOf('b')).toBe('waiting')
    expect(queue.stateOf('c')).toBeNull()
    // Asked again meanwhile: not twice; another added after those waiting.
    await queue.add([job('a', 2, pages), job('b', 1, pages), job('c', 1, pages)])
    expect(queue.waiting.map((one) => one.key)).toEqual(['b', 'c'])
    clock = 5000
    await pages.next()
    expect(queue.current).toMatchObject({ key: 'a', page: 2, since: 5000 })
    await pages.next()
    await pages.next()
    await pages.next()
    await done
    expect(queue.current).toBeNull()
    expect(queue.waiting).toEqual([])
    expect(queue.last).toEqual({ title: 'Doc c', ok: true })
  })

  it('stops after the page being read, forgets those waiting, and says so', async () => {
    const queue = new ScanQueue()
    const pages = gate()
    const changes: string[] = []
    queue.onChange(() => changes.push(queue.current ? `${queue.current.key}:${queue.current.page}` : 'idle'))
    const done = queue.add([job('a', 5, pages), job('b', 1, pages)])
    await Promise.resolve()
    queue.stop()
    expect(queue.waiting).toEqual([])
    await pages.next()
    await done
    expect(queue.last).toEqual({ title: 'Doc a', ok: false, reason: 'stopped' })
    expect(changes.at(-1)).toBe('idle')
    // Ready again afterwards.
    const again = queue.add([job('c', 1, pages)])
    await pages.next()
    await again
    expect(queue.last).toEqual({ title: 'Doc c', ok: true })
  })

  it('keeps going past a document that fails, saying why the last one ended', async () => {
    const queue = new ScanQueue()
    const pages = gate()
    const done = queue.add([job('a', 1, pages, 'délai dépassé'), job('b', 1, pages)])
    await pages.next()
    await pages.next()
    await done
    expect(queue.last).toEqual({ title: 'Doc b', ok: true })
    const failing = queue.add([job('c', 1, pages, 'refusé')])
    await pages.next()
    await failing
    expect(queue.last).toEqual({ title: 'Doc c', ok: false, reason: 'refusé' })
    queue.dismiss()
    expect(queue.last).toBeNull()
  })

  it('reads one document for someone waiting on it, in its turn, and hands back what it says', async () => {
    const queue = new ScanQueue()
    const pages = gate()
    const library = queue.add([job('a', 1, pages)])
    const chat = queue.read('file:b.pdf', 'b.pdf', 'occupé', async (progress) => {
      progress(1, 1)
      await pages.open()
      return 'texte de b'
    })
    expect(queue.stateOf('file:b.pdf')).toBe('waiting')
    // The same document asked for again meanwhile: refused, said why.
    await expect(queue.read('a', 'Doc a', 'déjà en lecture', () => Promise.resolve(''))).rejects.toThrow(
      'déjà en lecture'
    )
    await pages.next()
    await pages.next()
    await expect(chat).resolves.toBe('texte de b')
    await library
  })

  it('tells someone waiting that their document will not be read, when the queue is stopped', async () => {
    const queue = new ScanQueue()
    const pages = gate()
    const running = queue.add([job('a', 3, pages)])
    const chat = queue.read('file:b.pdf', 'b.pdf', 'occupé', () => Promise.resolve('jamais'))
    queue.stop()
    await expect(chat).rejects.toBeInstanceOf(ScanStopped)
    await pages.next()
    await running
  })
})
