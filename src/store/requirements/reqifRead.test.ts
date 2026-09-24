import { describe, expect, it } from 'vitest'
import { addLink, makeRequirement, setText, type Requirement } from './Requirement'
import { toReqif } from './reqif'
import { isReqifName, planReqifImport, readReqif, xhtmlText } from './reqifRead'
import { parseXml } from '../xmlParse'

const req = (over: Parameters<typeof makeRequirement>[0], body: string, lang = 'fr'): Requirement =>
  setText(makeRequirement({ sourceLang: lang, ...over }), lang, body, 'a')

const library = (): Requirement[] => [
  addLink(
    req(
      {
        id: 'REQ-THERM-0002',
        title: 'Régulation',
        category: 'THERM',
        type: 'functional',
        status: 'approved',
        criticality: 'high',
        verification: 'test',
        source: 'CDC §4',
        rationale: 'Confort',
        aliases: ['OMLX-THERM-0002']
      },
      'Le système doit réguler la température.\nÀ ±0,5 °C.\n\nEn toute saison & sans bruit < 30 dB.'
    ),
    'derives-from',
    'REQ-THERM-0001'
  ),
  req({ id: 'REQ-THERM-0001', title: 'Chauffage', category: 'THERM' }, 'Le système doit chauffer.')
]

describe('readReqif', () => {
  // The test that matters most: the library's own export, read back, changes nothing.
  it('reads its own export back as a library that has nothing to change', () => {
    const held = library()
    const read = readReqif(toReqif(held, { lang: 'fr', title: 'Bibliothèque' }), 'en')
    expect(read.error).toBeUndefined()
    expect(read.ignored).toEqual([])
    expect(read.ignoredRelations).toEqual([])
    expect(planReqifImport(read, held).map((row) => [row.id, row.action])).toEqual([
      ['REQ-THERM-0001', 'unchanged'],
      ['REQ-THERM-0002', 'unchanged']
    ])
  })

  it('reads every field its own export carries', () => {
    const read = readReqif(toReqif(library(), { lang: 'fr', title: 'B' }), 'en')
    expect(read.rows[1]).toEqual({
      id: 'REQ-THERM-0002',
      aliases: 'OMLX-THERM-0002',
      title: 'Régulation',
      'text.fr': 'Le système doit réguler la température.\nÀ ±0,5 °C.\n\nEn toute saison & sans bruit < 30 dB.',
      category: 'THERM',
      type: 'functional',
      status: 'approved',
      criticality: 'high',
      verification: 'test',
      source: 'CDC §4',
      rationale: 'Confort',
      links: 'derives-from: REQ-THERM-0001'
    })
  })

  it('sees a change made on the far side as a change', () => {
    const held = library()
    const edited = held.map((each) => (each.id === 'REQ-THERM-0001' ? { ...each, status: 'rejected' } : each))
    const plan = planReqifImport(readReqif(toReqif(edited, { lang: 'fr', title: 'B' }), 'fr'), held)
    expect(plan.find((row) => row.id === 'REQ-THERM-0001')?.action).toBe('update')
    expect(plan.find((row) => row.id === 'REQ-THERM-0002')?.action).toBe('unchanged')
  })

  // ReqIF has no place for a language; the export writes it in the header comment.
  it('reads the wordings in the language the file says it holds', () => {
    const translated = library().map((each) => setText(each, 'en', `English ${each.id}.`, 'a'))
    const read = readReqif(toReqif(translated, { lang: 'en', title: 'B' }), 'fr')
    expect(read).toMatchObject({ lang: 'en', langFromFile: true })
    expect(read.rows.map((row) => row['text.en'])).toEqual(['English REQ-THERM-0001.', 'English REQ-THERM-0002.'])
  })

  // An English export of a requirement nobody has translated carries its French words.
  // Read as English, they would come home as a translation that is not one.
  it('reads a wording that stood in for a missing translation as the language it is in', () => {
    const held = library()
    const read = readReqif(toReqif(held, { lang: 'en', title: 'B' }), 'en')
    expect(read.rows.every((row) => row['text.en'] === undefined && row['text.fr'] !== undefined)).toBe(true)
    expect(planReqifImport(read, held).map((row) => row.action)).toEqual(['unchanged', 'unchanged'])
  })

  it('creates a requirement in the language its wording is in, not the default', () => {
    const english = [req({ id: 'REQ-A-0001' }, 'The system shall start.', 'en')]
    const read = readReqif(toReqif(english, { lang: 'en', title: 'B' }), 'fr')
    expect(planReqifImport(read, []).map((row) => row.values.sourceLang)).toEqual(['en'])
  })

  // An English export of a French requirement, read back, is a translation coming home.
  it('leaves an existing requirement’s source language alone', () => {
    const held = library()
    const plan = planReqifImport(readReqif(toReqif(held, { lang: 'fr', title: 'B' }), 'fr'), held)
    expect(plan.every((row) => row.values.sourceLang === undefined)).toBe(true)
  })
})

/**
 * Shaped the way DOORS writes it: a prefixed namespace, an enumeration, a heading object,
 * attributes nobody here has a column for, XHTML with a list in it, and a relation type
 * of its own.
 */
const DOORS = `<?xml version="1.0" encoding="UTF-8"?>
<reqif:REQ-IF xmlns:reqif="http://www.omg.org/spec/ReqIF/20110401/reqif.xsd" xmlns:xhtml="http://www.w3.org/1999/xhtml">
  <reqif:THE-HEADER><reqif:REQ-IF-HEADER IDENTIFIER="h"><reqif:TITLE>Module SYS</reqif:TITLE></reqif:REQ-IF-HEADER></reqif:THE-HEADER>
  <reqif:CORE-CONTENT><reqif:REQ-IF-CONTENT>
    <reqif:DATATYPES>
      <reqif:DATATYPE-DEFINITION-ENUMERATION IDENTIFIER="dt-status" LONG-NAME="Status">
        <reqif:SPECIFIED-VALUES>
          <reqif:ENUM-VALUE IDENTIFIER="ev-1" LONG-NAME="Draft"/>
          <reqif:ENUM-VALUE IDENTIFIER="ev-2" LONG-NAME="Approved"/>
        </reqif:SPECIFIED-VALUES>
      </reqif:DATATYPE-DEFINITION-ENUMERATION>
    </reqif:DATATYPES>
    <reqif:SPEC-TYPES>
      <reqif:SPEC-OBJECT-TYPE IDENTIFIER="t-obj">
        <reqif:SPEC-ATTRIBUTES>
          <reqif:ATTRIBUTE-DEFINITION-STRING IDENTIFIER="a-id" LONG-NAME="ReqIF.ForeignID"/>
          <reqif:ATTRIBUTE-DEFINITION-XHTML IDENTIFIER="a-text" LONG-NAME="ReqIF.Text"/>
          <reqif:ATTRIBUTE-DEFINITION-XHTML IDENTIFIER="a-head" LONG-NAME="ReqIF.ChapterName"/>
          <reqif:ATTRIBUTE-DEFINITION-ENUMERATION IDENTIFIER="a-status" LONG-NAME="Status"/>
          <reqif:ATTRIBUTE-DEFINITION-STRING IDENTIFIER="a-verif" LONG-NAME="Verification"/>
          <reqif:ATTRIBUTE-DEFINITION-STRING IDENTIFIER="a-prio" LONG-NAME="Priority Level"/>
          <reqif:ATTRIBUTE-DEFINITION-DATE IDENTIFIER="a-date" LONG-NAME="Last Review"/>
        </reqif:SPEC-ATTRIBUTES>
      </reqif:SPEC-OBJECT-TYPE>
      <reqif:SPEC-RELATION-TYPE IDENTIFIER="r-der" LONG-NAME="Derives From"/>
      <reqif:SPEC-RELATION-TYPE IDENTIFIER="r-sat" LONG-NAME="Satisfies"/>
    </reqif:SPEC-TYPES>
    <reqif:SPEC-OBJECTS>
      <reqif:SPEC-OBJECT IDENTIFIER="o-head">
        <reqif:VALUES>
          <reqif:ATTRIBUTE-VALUE-XHTML><reqif:DEFINITION><reqif:ATTRIBUTE-DEFINITION-XHTML-REF>a-head</reqif:ATTRIBUTE-DEFINITION-XHTML-REF></reqif:DEFINITION><reqif:THE-VALUE><xhtml:div>1 Généralités</xhtml:div></reqif:THE-VALUE></reqif:ATTRIBUTE-VALUE-XHTML>
        </reqif:VALUES>
      </reqif:SPEC-OBJECT>
      <reqif:SPEC-OBJECT IDENTIFIER="o-1">
        <reqif:VALUES>
          <reqif:ATTRIBUTE-VALUE-STRING THE-VALUE="SYS-12"><reqif:DEFINITION><reqif:ATTRIBUTE-DEFINITION-STRING-REF>a-id</reqif:ATTRIBUTE-DEFINITION-STRING-REF></reqif:DEFINITION></reqif:ATTRIBUTE-VALUE-STRING>
          <reqif:ATTRIBUTE-VALUE-XHTML>
            <reqif:DEFINITION><reqif:ATTRIBUTE-DEFINITION-XHTML-REF>a-text</reqif:ATTRIBUTE-DEFINITION-XHTML-REF></reqif:DEFINITION>
            <reqif:THE-VALUE>
              <xhtml:div>
                <xhtml:p>The system shall <xhtml:b>log</xhtml:b>:</xhtml:p>
                <xhtml:ul><xhtml:li>every start,</xhtml:li><xhtml:li>every stop.</xhtml:li></xhtml:ul>
              </xhtml:div>
            </reqif:THE-VALUE>
          </reqif:ATTRIBUTE-VALUE-XHTML>
          <reqif:ATTRIBUTE-VALUE-ENUMERATION><reqif:DEFINITION><reqif:ATTRIBUTE-DEFINITION-ENUMERATION-REF>a-status</reqif:ATTRIBUTE-DEFINITION-ENUMERATION-REF></reqif:DEFINITION><reqif:VALUES><reqif:ENUM-VALUE-REF>ev-2</reqif:ENUM-VALUE-REF></reqif:VALUES></reqif:ATTRIBUTE-VALUE-ENUMERATION>
          <reqif:ATTRIBUTE-VALUE-STRING THE-VALUE="Inspection"><reqif:DEFINITION><reqif:ATTRIBUTE-DEFINITION-STRING-REF>a-verif</reqif:ATTRIBUTE-DEFINITION-STRING-REF></reqif:DEFINITION></reqif:ATTRIBUTE-VALUE-STRING>
          <reqif:ATTRIBUTE-VALUE-STRING THE-VALUE="P1"><reqif:DEFINITION><reqif:ATTRIBUTE-DEFINITION-STRING-REF>a-prio</reqif:ATTRIBUTE-DEFINITION-STRING-REF></reqif:DEFINITION></reqif:ATTRIBUTE-VALUE-STRING>
          <reqif:ATTRIBUTE-VALUE-DATE THE-VALUE="2026-01-01"><reqif:DEFINITION><reqif:ATTRIBUTE-DEFINITION-DATE-REF>a-date</reqif:ATTRIBUTE-DEFINITION-DATE-REF></reqif:DEFINITION></reqif:ATTRIBUTE-VALUE-DATE>
        </reqif:VALUES>
      </reqif:SPEC-OBJECT>
      <reqif:SPEC-OBJECT IDENTIFIER="o-2">
        <reqif:VALUES>
          <reqif:ATTRIBUTE-VALUE-STRING THE-VALUE="SYS-13"><reqif:DEFINITION><reqif:ATTRIBUTE-DEFINITION-STRING-REF>a-id</reqif:ATTRIBUTE-DEFINITION-STRING-REF></reqif:DEFINITION></reqif:ATTRIBUTE-VALUE-STRING>
          <reqif:ATTRIBUTE-VALUE-XHTML><reqif:DEFINITION><reqif:ATTRIBUTE-DEFINITION-XHTML-REF>a-text</reqif:ATTRIBUTE-DEFINITION-XHTML-REF></reqif:DEFINITION><reqif:THE-VALUE><xhtml:div>Logs shall be kept<xhtml:br/>for one year.</xhtml:div></reqif:THE-VALUE></reqif:ATTRIBUTE-VALUE-XHTML>
        </reqif:VALUES>
      </reqif:SPEC-OBJECT>
    </reqif:SPEC-OBJECTS>
    <reqif:SPEC-RELATIONS>
      <reqif:SPEC-RELATION IDENTIFIER="rel-1"><reqif:TYPE><reqif:SPEC-RELATION-TYPE-REF>r-der</reqif:SPEC-RELATION-TYPE-REF></reqif:TYPE><reqif:SOURCE><reqif:SPEC-OBJECT-REF>o-2</reqif:SPEC-OBJECT-REF></reqif:SOURCE><reqif:TARGET><reqif:SPEC-OBJECT-REF>o-1</reqif:SPEC-OBJECT-REF></reqif:TARGET></reqif:SPEC-RELATION>
      <reqif:SPEC-RELATION IDENTIFIER="rel-2"><reqif:TYPE><reqif:SPEC-RELATION-TYPE-REF>r-sat</reqif:SPEC-RELATION-TYPE-REF></reqif:TYPE><reqif:SOURCE><reqif:SPEC-OBJECT-REF>o-1</reqif:SPEC-OBJECT-REF></reqif:SOURCE><reqif:TARGET><reqif:SPEC-OBJECT-REF>o-2</reqif:SPEC-OBJECT-REF></reqif:TARGET></reqif:SPEC-RELATION>
    </reqif:SPEC-RELATIONS>
  </reqif:REQ-IF-CONTENT></reqif:CORE-CONTENT>
</reqif:REQ-IF>`

describe('readReqif, on a file another tool wrote', () => {
  const read = readReqif(DOORS, 'en')

  it('reads the requirements, whatever prefix the tool put on its elements', () => {
    expect(read.rows.map((row) => row.id)).toEqual(['SYS-12', 'SYS-13'])
  })

  it('takes the language it was given when the file does not say', () => {
    expect(read).toMatchObject({ lang: 'en', langFromFile: false })
  })

  it('takes the language the header names when there is one', () => {
    const named = DOORS.replace('<reqif:TITLE>', '<reqif:COMMENT>Language: DE</reqif:COMMENT><reqif:TITLE>')
    const read = readReqif(named, 'en')
    expect(read).toMatchObject({ lang: 'de', langFromFile: true })
    expect(Object.keys(planReqifImport(read, [])[0].values.text)).toEqual(['de'])
  })

  it('reads an enumeration as the name of the value, not its identifier', () => {
    expect(read.rows[0].status).toBe('Approved')
  })

  it('reads a verification method however the tool capitalised it', () => {
    expect(read.rows[0].verification).toBe('inspection')
  })

  it('reads formatted text as the words, with its list and its line breaks', () => {
    expect(read.rows[0]['text.en']).toBe('The system shall log:\n\n- every start,\n- every stop.')
    expect(read.rows[1]['text.en']).toBe('Logs shall be kept\nfor one year.')
  })

  // The failure that kept ReqIF export-only: an importer dropping what it does not know.
  it('names every attribute it has no place for', () => {
    expect(read.ignored).toEqual(['Last Review', 'Priority Level'])
  })

  it('names a relation type the library has no kind for, and keeps the one it has', () => {
    expect(read.ignoredRelations).toEqual(['Satisfies'])
    expect(read.rows[1].links).toBe('derives-from: SYS-12')
    expect(read.rows[0].links).toBeUndefined()
  })

  it('counts a chapter heading rather than creating a requirement from it', () => {
    expect(read.headings).toBe(1)
  })

  it('plans the lot as new requirements in the file’s language', () => {
    const plan = planReqifImport(read, [])
    expect(plan.map((row) => [row.id, row.action, row.values.sourceLang])).toEqual([
      ['SYS-12', 'create', 'en'],
      ['SYS-13', 'create', 'en']
    ])
    expect(plan[1].values.links).toEqual([{ kind: 'derives-from', to: 'SYS-12' }])
  })
})

describe('readReqif, on what it cannot read', () => {
  it('says a file is not ReqIF rather than reading it as empty', () => {
    expect(readReqif('<requirements/>', 'fr').error).toBe('root: <requirements>')
  })

  it('says where a malformed file breaks', () => {
    expect(readReqif('<REQ-IF><CORE-CONTENT></REQ-IF>', 'fr').error).toMatch(/closes <CORE-CONTENT>.*at \d+/)
  })
})

describe('xhtmlText', () => {
  it('drops the indentation between tags, which is layout and not anybody’s words', () => {
    expect(xhtmlText(parseXml('<v>\n  <p>  un  </p>\n  <p>deux</p>\n</v>'))).toBe('un\n\ndeux')
  })

  it('keeps a list item on its line when the tool wrapped it in a paragraph', () => {
    expect(xhtmlText(parseXml('<v><ul><li><p>un</p></li><li><p>deux</p></li></ul></v>'))).toBe('- un\n- deux')
  })
})

describe('isReqifName', () => {
  it('knows both forms a ReqIF is sent in', () => {
    expect(['a.reqif', 'b.REQIFZ', 'c.xml'].map(isReqifName)).toEqual([true, true, false])
  })
})
