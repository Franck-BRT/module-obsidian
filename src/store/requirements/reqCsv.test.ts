import { describe, expect, it } from 'vitest'
import { addLink, makeRequirement, setText } from './Requirement'
import { addAlias } from './reqAlias'
import { countPlan, csvField, detectSeparator, parseCsv, planCsvImport, readCsvTable, toCsv } from './reqCsv'

function req(id: string, fr: string, over: Parameters<typeof makeRequirement>[0] = {}) {
  return setText(makeRequirement({ id, sourceLang: 'fr', ...over }), 'fr', fr, 'franck')
}

describe('csvField', () => {
  it('leaves a plain value alone, so the file can be read in a text editor', () => {
    expect(csvField('approved', ';')).toBe('approved')
  })

  it('quotes a value holding the separator', () => {
    expect(csvField('a;b', ';')).toBe('"a;b"')
  })

  it('doubles a quotation mark rather than losing it', () => {
    expect(csvField('dit "oui"', ';')).toBe('"dit ""oui"""')
  })

  it('quotes a value holding a line break', () => {
    expect(csvField('a\nb', ';')).toBe('"a\nb"')
  })
})

describe('detectSeparator', () => {
  it('reads a French export', () => {
    expect(detectSeparator('id;title;status\r\nREQ-A-0001;Trappe;draft\r\n')).toBe(';')
  })

  it('reads an English one', () => {
    expect(detectSeparator('id,title,status\nREQ-A-0001,Trappe,draft\n')).toBe(',')
  })

  it('reads a tab-separated one', () => {
    expect(detectSeparator('id\ttitle\tstatus\n')).toBe('\t')
  })

  // A single header field holding "a, b, c" must not decide the whole file.
  it('does not count a separator that is inside a quoted field', () => {
    expect(detectSeparator('id;"title, subtitle";status\n')).toBe(';')
  })
})

describe('parseCsv', () => {
  it('reads a plain table', () => {
    expect(parseCsv('a;b\n1;2\n')).toEqual([
      ['a', 'b'],
      ['1', '2']
    ])
  })

  it('reads a field holding the separator', () => {
    expect(parseCsv('a;b\n"x;y";2\n')).toEqual([
      ['a', 'b'],
      ['x;y', '2']
    ])
  })

  it('reads a field holding a line break, rather than splitting the requirement in two', () => {
    expect(parseCsv('a;b\n"premier\nsecond";2\n')).toEqual([
      ['a', 'b'],
      ['premier\nsecond', '2']
    ])
  })

  it('reads a doubled quotation mark back as one', () => {
    expect(parseCsv('a\n"dit ""oui"""\n')).toEqual([['a'], ['dit "oui"']])
  })

  it('survives a file with no final newline', () => {
    expect(parseCsv('a;b\n1;2')).toEqual([
      ['a', 'b'],
      ['1', '2']
    ])
  })

  it('drops the blank lines a spreadsheet leaves behind', () => {
    expect(parseCsv('a;b\n1;2\n\n;\n')).toHaveLength(2)
  })

  it('eats a byte-order mark rather than hiding it in the first header', () => {
    expect(readCsvTable('﻿id;title\nREQ-A-0001;Trappe\n').rows[0].id).toBe('REQ-A-0001')
  })
})

describe('toCsv', () => {
  const library = [
    req('REQ-A-0001', 'La trappe doit ouvrir en 3 s.', { title: 'Trappe', status: 'approved', tags: ['vol'] }),
    setText(req('REQ-A-0002', 'Le bus doit tenir 3 h.'), 'en', 'The bus shall last 3 h.', 'a')
  ]

  it('writes a column per language actually used', () => {
    const header = toCsv(library).split('\r\n')[0]
    expect(header).toContain('text.fr')
    expect(header).toContain('text.en')
  })

  it('reads back as the same table', () => {
    const table = readCsvTable(toCsv(library))
    expect(table.rows).toHaveLength(2)
    expect(table.rows[0].id).toBe('REQ-A-0001')
    expect(table.rows[0]['text.fr']).toBe('La trappe doit ouvrir en 3 s.')
    expect(table.rows[1]['text.en']).toBe('The bus shall last 3 h.')
  })

  // A spreadsheet that came back without them would silently drop the names a whole
  // project's documents are written in.
  it('carries the aliases across', () => {
    const aliased = [addAlias(library[0], 'OMLX-SYS-0001')]
    expect(readCsvTable(toCsv(aliased)).rows[0].aliases).toBe('OMLX-SYS-0001')
  })

  it('carries the links across', () => {
    const linked = [addLink(library[0], 'derives-from', 'REQ-A-0002')]
    expect(readCsvTable(toCsv(linked)).rows[0].links).toBe('derives-from:REQ-A-0002')
  })

  // A requirement reading "moins de 3,5 s" split across two columns is the kind of
  // failure nobody notices until the supplier quotes it back.
  it('survives a wording holding the separator', () => {
    const tricky = [req('REQ-A-0003', 'Moins de 3,5 s ; au plus 2 tentatives.')]
    expect(readCsvTable(toCsv(tricky)).rows[0]['text.fr']).toBe('Moins de 3,5 s ; au plus 2 tentatives.')
  })
})

describe('readCsvTable', () => {
  it('names a column it does not know rather than ignoring it', () => {
    expect(readCsvTable('id;statut\nREQ-A-0001;approuvée\n').unknown).toEqual(['statut'])
  })

  it('knows a language column it has never seen', () => {
    expect(readCsvTable('id;text.de\nREQ-A-0001;Etwas\n').unknown).toEqual([])
  })

  it('has nothing to say about an empty file', () => {
    expect(readCsvTable('')).toEqual({ headers: [], rows: [], unknown: [] })
  })
})

describe('planCsvImport', () => {
  const library = [req('REQ-A-0001', 'La trappe doit ouvrir en 3 s.', { title: 'Trappe', status: 'approved' })]

  const plan = (csv: string) => planCsvImport(readCsvTable(csv).rows, library)

  // A file written in a project's own numbering names the requirement, not a new one.
  it('reads a row named by an alias as the requirement that answers to it', () => {
    const aliased = [{ ...library[0], aliases: ['OMLX-A-0001'] }]
    const rows = planCsvImport(readCsvTable('id;title;status\nomlx-a-0001;Trappe;draft\n').rows, aliased)
    expect(rows[0]).toMatchObject({ action: 'update', id: 'REQ-A-0001' })
  })

  it('counts a requirement named twice, once by each of its names, as named twice', () => {
    const aliased = [{ ...library[0], aliases: ['OMLX-A-0001'] }]
    const rows = planCsvImport(
      readCsvTable('id;title;status\nREQ-A-0001;Trappe;draft\nOMLX-A-0001;Trappe;approved\n').rows,
      aliased
    )
    expect(rows.map((row) => row.action)).toEqual(['update', 'invalid'])
  })

  it('creates a requirement written in one language with that language as its source', () => {
    const rows = plan('id;text.en\nREQ-B-0001;The hatch shall open.\n')
    expect(rows[0].values.sourceLang).toBe('en')
  })

  it('leaves the source language to the file when the file says it', () => {
    const rows = plan('id;sourceLang;text.en\nREQ-B-0001;fr;The hatch shall open.\n')
    expect(rows[0].values.sourceLang).toBe('fr')
  })

  it('sees a row that would change nothing', () => {
    const rows = plan('id;title;status;text.fr\nREQ-A-0001;Trappe;approved;La trappe doit ouvrir en 3 s.\n')
    expect(rows[0].action).toBe('unchanged')
  })

  it('sees a row that would rewrite the words', () => {
    const rows = plan('id;text.fr\nREQ-A-0001;La trappe doit ouvrir en 5 s.\n')
    expect(rows[0].action).toBe('update')
  })

  it('sees a row that would give a requirement a name it does not have', () => {
    const rows = plan('id;aliases;text.fr\nREQ-A-0001;OMLX-SYS-0001;La trappe doit ouvrir en 3 s.\n')
    expect(rows[0].action).toBe('update')
    expect(rows[0].values.aliases).toEqual(['OMLX-SYS-0001'])
  })

  it('sees a row that would change only a field', () => {
    const rows = plan('id;status;text.fr\nREQ-A-0001;implemented;La trappe doit ouvrir en 3 s.\n')
    expect(rows[0].action).toBe('update')
  })

  // Importing a supplier's requirements and renumbering them would break every reference
  // in their documents, which is the one thing an identifier exists to prevent.
  it('keeps an identifier the file carries', () => {
    const rows = plan('id;text.fr\nREQ-EXT-0042;Exigence du fournisseur.\n')
    expect(rows[0]).toMatchObject({ action: 'create', id: 'REQ-EXT-0042' })
  })

  it('leaves a row with no identifier to be minted one', () => {
    const rows = plan('title;text.fr\nNouvelle;Une exigence sans identifiant.\n')
    expect(rows[0]).toMatchObject({ action: 'create', id: '' })
  })

  it('refuses a row that would create a requirement saying nothing', () => {
    const rows = plan('id;status\nREQ-A-0009;draft\n')
    expect(rows[0]).toMatchObject({ action: 'invalid', reason: 'no-wording' })
  })

  it('refuses the second row carrying an identifier the file already used', () => {
    const rows = plan('id;text.fr\nREQ-A-0007;Une.\nREQ-A-0007;Deux.\n')
    expect(rows[0].action).toBe('create')
    expect(rows[1]).toMatchObject({ action: 'invalid', reason: 'duplicate-id' })
  })

  it('reads the tags and the links a row carries', () => {
    const rows = plan('id;text.fr;tags;links\nREQ-A-0008;Une.;"vol; sécurité";derives-from:REQ-A-0001\n')
    expect(rows[0].values.tags).toEqual(['vol', 'sécurité'])
    expect(rows[0].values.links).toEqual([{ kind: 'derives-from', to: 'REQ-A-0001' }])
  })

  it('ignores a verification method that is not one', () => {
    const rows = plan('id;text.fr;verification\nREQ-A-0010;Une.;par magie\n')
    expect(rows[0].values.verification).toBeUndefined()
  })

  it('counts what a file would do', () => {
    const rows = plan('id;text.fr\nREQ-A-0001;La trappe doit ouvrir en 3 s.\nREQ-A-0020;Nouvelle.\nREQ-A-0021;\n')
    expect(countPlan(rows)).toEqual({ create: 1, update: 0, unchanged: 1, invalid: 1 })
  })
})
