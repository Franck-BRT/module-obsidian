import { describe, expect, it } from 'vitest'
import { readSpreadsheet, readXls } from './xlsRead'
import { buildXlsx } from './xlsx'
import { fileText } from './chat/chatFile'
import { bytesOf } from '../../test/docFixtures'
import { cryptoApi, planning, rc4 } from '../../test/xlsFixtures'

describe('readXls', () => {
  it('reads each sheet: text, dates as dates, numbers, truth values', async () => {
    const [first, second] = await readXls(bytesOf(planning))
    expect(first).toEqual({
      name: 'Planning',
      rows: [
        ['Tâche', 'Début', 'Durée (j)', 'Coût €'],
        ['Terrassement', '2026-10-05', '12', '1234.5'],
        ['Fondations | radier', '2026-11-02', '20', '-0.25'],
        ['Объект', '', '', 'TRUE']
      ]
    })
    // Strings cut between records, one byte or two a character, come back whole.
    expect(second.rows).toHaveLength(120)
    expect(second.rows[0][0]).toBe(`Ligne 0 — ${'é'.repeat(35)}`)
    expect(second.rows[118][0]).toBe(`Ligne 118 — ${'é'.repeat(35)}xxxxxx`)
    expect(second.rows[119][0]).toBe(`Ligne 119 — ${'Σ'.repeat(35)}`)
    expect(second.rows.every((row, at) => row[0].startsWith(`Ligne ${at} — `))).toBe(true)
  })

  it('opens a workbook Excel enciphered, with its password, by both of its ways', async () => {
    const standard = await readXls(bytesOf(rc4), 'password')
    expect(standard[0].name).toBe('Лист1')
    expect(standard[0].rows[0].join(' ')).toContain('A ZIP bomb is a variant of mail-bombing.')
    expect(await readXls(bytesOf(cryptoApi), 'freedom')).toEqual([{ name: 'Sheet1', rows: [['hello there!']] }])
  })

  it('refuses one that takes a password other than Excel’s own, saying so', async () => {
    await expect(readXls(bytesOf(rc4))).rejects.toThrow(/password/)
    await expect(readXls(bytesOf(cryptoApi))).rejects.toThrow(/password/)
  })
})

describe('readSpreadsheet', () => {
  it('reads either format by what the file is, whatever its name', async () => {
    const xlsx = buildXlsx([{ name: 'Lot', columns: [{ label: 'Tâche', width: 10 }], rows: [['Radier']] }])
    expect((await readSpreadsheet(xlsx))[0].rows).toEqual([['Tâche'], ['Radier']])
    expect((await readSpreadsheet(bytesOf(planning)))[0].name).toBe('Planning')
  })

  it('gives an .xls and an .xlsm to the chat and the library as text', async () => {
    expect(await fileText('xls', bytesOf(planning))).toMatch(
      /^## Planning\n\n\| Tâche \| Début \| Durée \(j\) \| Coût € \|/
    )
    const xlsx = buildXlsx([{ name: 'Lot', columns: [{ label: 'Tâche', width: 10 }], rows: [['Radier']] }])
    expect(await fileText('xlsm', xlsx)).toBe('## Lot\n\n| Tâche |\n| Radier |')
  })
})
