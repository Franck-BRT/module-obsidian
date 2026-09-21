import type { App } from 'obsidian'
import { beforeEach, describe, expect, it } from 'vitest'
import { makeFakeApp } from '../../../test/fakeVault'
import { DEFAULT_SETTINGS, type PMSettings } from '../../types'
import type { HttpTransport } from '../llm'
import { VaultIndex } from '../VaultIndex'
import { setText, textOf } from './Requirement'
import { RequirementStore } from './RequirementStore'
import { RequirementTranslator } from './RequirementTranslator'

/** A gateway that answers whatever the test needs, in the shape the real one uses. */
function gateway(answers: (string | { status: number; body: string })[]) {
  const seen: Parameters<HttpTransport>[0][] = []
  let at = 0
  const transport: HttpTransport = (request) => {
    seen.push(request)
    const answer = answers[Math.min(at, answers.length - 1)]
    at += 1
    if (typeof answer !== 'string') return Promise.resolve({ status: answer.status, text: answer.body })
    return Promise.resolve({
      status: 200,
      text: JSON.stringify({ choices: [{ message: { content: answer } }] })
    })
  }
  return { transport, seen, calls: () => at }
}

const said = (text: string, notes = ''): string => JSON.stringify({ text, notes })

describe('RequirementTranslator', () => {
  let app: App
  let index: VaultIndex
  let settings: PMSettings
  let store: RequirementStore

  beforeEach(() => {
    app = makeFakeApp({ liveMetadataCache: true }).app as unknown as App
    settings = structuredClone(DEFAULT_SETTINGS)
    settings.llm = {
      ...settings.llm,
      enabled: true,
      baseUrl: 'http://gateway.invalid/v1',
      modelTranslate: 'sidonie/mistral-cnes-latest'
    }
    index = new VaultIndex(app, () => settings)
    store = new RequirementStore(
      app,
      () => settings.requirements,
      () => Promise.resolve(),
      index
    )
  })

  async function seed(body: string, title = 'Trappe') {
    const created = await store.create({ title, category: 'SYS' })
    const path = created?.filePath ?? ''
    const saved = await store.update(path, (requirement) => setText(requirement, 'fr', body, 'franck'))
    return { path, requirement: saved }
  }

  it('is unavailable until there is a gateway and a model to translate with', () => {
    const translator = new RequirementTranslator(() => settings, store)
    expect(translator.available).toBe(true)
    settings.llm.modelTranslate = ''
    expect(translator.available).toBe(false)
    settings.llm.modelTranslate = 'm'
    settings.llm.enabled = false
    expect(translator.available).toBe(false)
  })

  it('writes the translation into the requirement, marked as a machine draft', async () => {
    const { path, requirement } = await seed('La trappe doit ouvrir en moins de 3 s.')
    const { transport, seen } = gateway([said('The hatch shall open in under 3 s.')])
    const outcome = await new RequirementTranslator(() => settings, store, transport).translate(
      requirement as never,
      'en'
    )

    expect(outcome.ok).toBe(true)
    expect(outcome.drift).toBeUndefined()
    const reloaded = await store.load(path)
    expect(textOf(reloaded as never, 'en')?.body).toBe('The hatch shall open in under 3 s.')
    expect(textOf(reloaded as never, 'en')?.origin).toBe('machine')
    // Unreviewed, because nobody has read it. This is the whole discipline.
    expect(textOf(reloaded as never, 'en')?.reviewed).toBe(false)
    expect(seen[0].url).toBe('http://gateway.invalid/v1/chat/completions')
  })

  it('translating does not bump the revision: a translation is catching up, not a change', async () => {
    const { path, requirement } = await seed('La trappe doit ouvrir.')
    const { transport } = gateway([said('The hatch shall open.')])
    await new RequirementTranslator(() => settings, store, transport).translate(requirement as never, 'en')
    expect((await store.load(path))?.rev).toBe(1)
  })

  it('reports the figures that moved, and still keeps the draft', async () => {
    const { path, requirement } = await seed('Entre −40 °C et +70 °C.')
    const { transport } = gateway([said('Between 40 °C and +70 °C.')])
    const outcome = await new RequirementTranslator(() => settings, store, transport).translate(
      requirement as never,
      'en'
    )

    expect(outcome.ok).toBe(true)
    expect(outcome.drift?.missing).toContain('-40')
    // Kept, not withheld: a reader cannot judge a warning about a sentence they cannot see.
    expect(textOf((await store.load(path)) as never, 'en')?.body).toBe('Between 40 °C and +70 °C.')
  })

  it('translates from the source language, never from another translation', async () => {
    const { path } = await seed('La trappe doit ouvrir.')
    await store.update(path, (current) => setText(current, 'en', 'The hatch shall open.', 'a'))
    const reloaded = await store.load(path)
    const { transport, seen } = gateway([said('Die Luke muss sich öffnen.')])
    await new RequirementTranslator(() => settings, store, transport).translate(reloaded as never, 'de')

    const body = JSON.parse(seen[0].body ?? '{}') as { messages: { role: string; content: string }[] }
    expect(body.messages[1].content).toBe('La trappe doit ouvrir.')
    expect(body.messages[0].content).toContain('French')
    expect(body.messages[0].content).toContain('German')
  })

  it('refuses to translate a language into itself', async () => {
    const { requirement } = await seed('La trappe doit ouvrir.')
    const { transport, calls } = gateway([said('x')])
    const outcome = await new RequirementTranslator(() => settings, store, transport).translate(
      requirement as never,
      'fr'
    )
    expect(outcome.ok).toBe(false)
    expect(outcome.error).toBe('same-language')
    expect(calls()).toBe(0)
  })

  it('says so rather than writing a blank when the gateway answers with nothing', async () => {
    const { path, requirement } = await seed('La trappe doit ouvrir.')
    const { transport } = gateway([said('   ')])
    const outcome = await new RequirementTranslator(() => settings, store, transport).translate(
      requirement as never,
      'en'
    )
    expect(outcome.ok).toBe(false)
    expect(textOf((await store.load(path)) as never, 'en')).toBeNull()
  })

  describe('a whole shelf at once', () => {
    async function shelf(count: number) {
      const jobs: { requirement: never; lang: string }[] = []
      for (let i = 0; i < count; i++) {
        const { requirement } = await seed(`Exigence numéro ${i}.`, `Exigence ${i}`)
        jobs.push({ requirement: requirement as never, lang: 'en' })
      }
      return jobs
    }

    it('works through them one at a time and reports progress', async () => {
      const jobs = await shelf(3)
      const { transport, calls } = gateway([said('Requirement.')])
      const seenProgress: number[] = []
      const outcomes = await new RequirementTranslator(() => settings, store, transport).translateMany(
        jobs,
        (progress) => seenProgress.push(progress.done)
      )

      expect(outcomes.filter((outcome) => outcome.ok)).toHaveLength(3)
      expect(calls()).toBe(3)
      expect(seenProgress).toEqual([0, 1, 2, 3])
    })

    // A bad status is about this requirement and the run goes on; a gateway that cannot be
    // reached at all is about every one of them, and grinding through five hundred doomed
    // calls is the difference between a failed run and a hung afternoon.
    it('stops the moment the network is the problem, rather than failing once per requirement', async () => {
      const jobs = await shelf(5)
      let attempts = 0
      const dead: HttpTransport = () => {
        attempts += 1
        return Promise.reject(new Error('ECONNREFUSED'))
      }
      const outcomes = await new RequirementTranslator(() => settings, store, dead).translateMany(jobs)
      expect(outcomes).toHaveLength(1)
      expect(outcomes[0].fatal).toBe(true)
      expect(attempts).toBe(1)
    })

    it('gives up after three failures in a row rather than grinding through the library', async () => {
      const jobs = await shelf(10)
      const { transport, calls } = gateway([{ status: 500, body: 'boom' }])
      const outcomes = await new RequirementTranslator(() => settings, store, transport).translateMany(jobs)
      expect(outcomes).toHaveLength(3)
      // Twice each: a gateway failure on a structured request is answered by asking the
      // same question again in plain words, and only then counted as a failure.
      expect(calls()).toBe(6)
    })

    it('stops when the reader asks it to', async () => {
      const jobs = await shelf(5)
      const { transport, calls } = gateway([said('Requirement.')])
      let done = 0
      const outcomes = await new RequirementTranslator(() => settings, store, transport).translateMany(
        jobs,
        () => {
          done += 1
        },
        () => done > 2
      )
      expect(outcomes.length).toBeLessThan(5)
      expect(calls()).toBeLessThan(5)
    })
  })
})
