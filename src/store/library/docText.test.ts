import { describe, expect, it } from 'vitest'
import { buildDocx, para, type DocxDocument } from '../docx'
import { buildPdf } from '../pdf'
import { buildXlsx } from '../xlsx'
import {
  decodeText,
  encodeText,
  extractText,
  foldWithMap,
  snippet,
  TEXT_LIMIT,
  TEXT_VERSION,
  type Snippet
} from './docText'

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text)
const WORDS = { from: 'De :', to: 'À :', date: 'Date :', attachments: 'Pièces jointes :' }
const doc = (blocks: DocxDocument['blocks']): DocxDocument => ({ title: 'Spécification', blocks })
const LONG =
  'Le soutènement de la zone B doit être achevé avant la pose des ventilateurs, prévue le 12 octobre, faute de quoi le radier glisse de deux semaines et la réception avec lui.'
/** A snippet as one line, the words found in brackets. */
const shown = (found: Snippet | null): string =>
  found
    ? `${found.before ? '…' : ''}${found.parts.map((part) => (part.hit ? `[${part.text}]` : part.text)).join('')}${found.after ? '…' : ''}`
    : ''

describe('keeping a text', () => {
  it('reads back what it wrote, and of an older reader only what it could read', () => {
    const entry = { state: 'ok' as const, text: 'ligne 1\nligne 2', mtime: 1727500000000 }
    expect(decodeText(encodeText(entry))).toEqual(entry)
    expect(decodeText(encodeText({ ...entry, state: 'scan', ocr: true }))).toEqual({
      ...entry,
      state: 'scan',
      ocr: true
    })
    expect(decodeText(`pm-text 1 ok 1\ntexte`)).toEqual({ state: 'ok', text: 'texte', mtime: 1 })
    // What it could not read — a locked PDF — the reader of now tries again.
    expect(decodeText(`pm-text 1 unreadable 1\n`)).toBeNull()
    expect(decodeText(`pm-text ${TEXT_VERSION} unreadable 1\n`)).toEqual({ state: 'unreadable', text: '', mtime: 1 })
    expect(decodeText(`pm-text ${TEXT_VERSION + 1} ok 1\ntexte`)).toBeNull()
    expect(decodeText(`pm-text ${TEXT_VERSION} what 1\ntexte`)).toBeNull()
    expect(decodeText('autre chose')).toBeNull()
    expect(decodeText(`pm-text ${TEXT_VERSION} empty 5`)).toEqual({ state: 'empty', text: '', mtime: 5 })
  })
})

describe('extractText', () => {
  it('reads a PDF, a Word file and a workbook with the readers the imports use', async () => {
    const pdf = await extractText('Spec.pdf', buildPdf(doc([para('Normal', LONG), para('Normal', LONG)])), WORDS)
    expect(pdf.state).toBe('ok')
    expect(pdf.text).toContain('ventilateurs')
    const word = await extractText(
      'CCTP.docx',
      buildDocx(doc([para('Heading1', 'Terrassements'), para('Normal', LONG)])),
      WORDS
    )
    expect(word).toMatchObject({ state: 'ok' })
    expect(word.text).toContain('## Terrassements')
    const sheet = await extractText(
      'Budget.XLSX',
      buildXlsx([
        {
          name: 'Lot 1',
          columns: [
            { label: 'Poste', width: 10 },
            { label: 'Montant', width: 8 }
          ],
          rows: [['Radier', 120000]]
        }
      ]),
      WORDS
    )
    expect(sheet.text).toContain('| Radier | 120000 |')
  })

  it('reads a message as who wrote it, to whom, when, what it says and what came with it', async () => {
    const eml = [
      'From: Anne Martin <anne@exemple.fr>',
      'To: chantier@exemple.fr',
      'Subject: =?UTF-8?Q?R=C3=A9union_de_chantier?=',
      'Date: Mon, 28 Sep 2026 09:00:00 +0200',
      'Content-Type: text/plain; charset=utf-8',
      '',
      'Le radier est décalé au 19/10.'
    ].join('\r\n')
    const mail = await extractText('CR.eml', bytes(eml), WORDS)
    expect(mail.state).toBe('ok')
    expect(mail.text).toContain('# Réunion de chantier')
    expect(mail.text).toContain('De : Anne Martin <anne@exemple.fr>')
    expect(mail.text).toContain('Le radier est décalé au 19/10.')
  })

  it('says a picture and a PDF with next to no text are scans, for a model to read', async () => {
    expect(await extractText('photo.JPG', bytes('x'), WORDS)).toEqual({ state: 'scan', text: '' })
    const thin = await extractText('scan.pdf', buildPdf(doc([para('Normal', 'Page 1')])), WORDS)
    expect(thin.state).toBe('scan')
  })

  it('says why there is nothing: no reader for the format, nothing in it, or unreadable', async () => {
    expect(await extractText('vieux.doc', bytes('x'), WORDS)).toEqual({ state: 'unsupported', text: '' })
    expect(await extractText('vide.txt', bytes('   '), WORDS)).toEqual({ state: 'empty', text: '' })
    expect(await extractText('abîmé.pdf', bytes('pas un pdf'), WORDS)).toEqual({ state: 'unreadable', text: '' })
    expect(await extractText('abîmé.docx', bytes('pas un zip'), WORDS)).toEqual({ state: 'unreadable', text: '' })
  })

  it('keeps the start of a very long text', async () => {
    const long = await extractText('long.txt', bytes('a'.repeat(TEXT_LIMIT + 50_000)), WORDS)
    expect(long.text).toHaveLength(TEXT_LIMIT)
  })
})

describe('snippet', () => {
  it('shows the passage round the first word found, the words found marked, whatever the accents', () => {
    const text = `Introduction générale. ${'Du texte. '.repeat(30)}${LONG} ${'Encore du texte. '.repeat(30)}`
    const found = snippet(text, ['VENTILATEURS', 'radier'])
    expect(shown(found)).toMatch(/^….*\[ventilateurs\].*\[radier\].*…$/)
    expect(shown(snippet(text, ['soutenement']))).toContain('[soutènement]')
  })

  it('does not cut words at its ends', () => {
    const text = `${'mots '.repeat(60)}cible ${'mots '.repeat(60)}`
    const found = shown(snippet(text, ['cible'], undefined, 22))
    expect(found).toMatch(/^…(mots )+\[cible\]( mots)+…$/)
  })

  it('marks every time a word comes back in the passage, and nothing when it is not there', () => {
    expect(shown(snippet('Radier puis radier.', ['radier']))).toBe('[Radier] puis [radier].')
    expect(snippet('Rien ici.', ['radier'])).toBeNull()
    expect(snippet('', ['radier'])).toBeNull()
    expect(snippet('Radier', ['  '])).toBeNull()
  })

  it('centres on the word found first in the text, whichever was typed first', () => {
    const text = `Soutènement en zone B. ${'Texte. '.repeat(60)}Radier au 19/10.`
    expect(shown(snippet(text, ['radier', 'soutenement']))).toMatch(/^\[Soutènement\]/)
  })

  it('stops at its end even when a word found comes back further on', () => {
    const text = `Radier. ${'Texte. '.repeat(80)}Radier encore.`
    const found = shown(snippet(text, ['radier']))
    expect(found).toMatch(/^\[Radier\]\. (Texte\. )*Texte\.…$/)
  })

  it('puts the passage on one line, read as prose rather than as Markdown', () => {
    expect(shown(snippet('Planning\n\n| Radier | 19/10 |', ['radier']))).toBe('Planning · [Radier] · 19/10')
    expect(shown(snippet('## Budget\n\n| Poste | Montant |\n| Radier | 120 |', ['radier']))).toBe(
      'Budget · Poste · Montant · [Radier] · 120'
    )
    expect(shown(snippet('# Réunion 12\n\nLe radier au #3.', ['radier']))).toBe('Réunion 12 Le [radier] au #3.')
  })

  it('finds its place in a text whose accents are written apart from their letters', () => {
    // « é » as « e » and a combining accent: two characters, one once folded.
    const apart = 'Le décalage du radier.'
    expect(foldWithMap(apart).folded).toBe('le decalage du radier.')
    expect(shown(snippet(apart, ['radier']))).toBe('Le décalage du [radier].')
    expect(shown(snippet(apart, ['decalage']))).toBe('Le [décalage] du radier.')
  })
})
