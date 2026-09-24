import { describe, expect, it } from 'vitest'
import { child, children, decodeEntities, parseXml, XmlError } from './xmlParse'

describe('decodeEntities', () => {
  it('decodes the five XML knows by name', () => {
    expect(decodeEntities('&lt;a&gt; &amp; &quot;b&quot; &apos;c&apos;')).toBe('<a> & "b" \'c\'')
  })

  it('decodes a character written as a number, in either base', () => {
    expect(decodeEntities('&#233;t&#xE9;')).toBe('été')
  })

  // Left as written rather than guessed at.
  it('leaves an entity nobody declared alone', () => {
    expect(decodeEntities('&nbsp;')).toBe('&nbsp;')
  })
})

describe('parseXml', () => {
  it('reads a tree, its attributes and its text', () => {
    const root = parseXml('<?xml version="1.0"?><a x="1" y=\'deux\'><b>texte</b><c/></a>')
    expect(root.name).toBe('a')
    expect(root.attrs).toEqual({ x: '1', y: 'deux' })
    expect(child(root, 'b')?.text).toBe('texte')
    expect(child(root, 'c')?.children).toEqual([])
  })

  it('finds every child of a name, in order', () => {
    const root = parseXml('<a><t>1</t><u/><t>2</t></a>')
    expect(children(root, 't').map((node) => node.text)).toEqual(['1', '2'])
  })

  // A requirement written on three lines means something by being on three lines.
  it('keeps the text exactly as it was, line breaks and all', () => {
    expect(parseXml('<a>  un\n  deux  </a>').text).toBe('  un\n  deux  ')
  })

  // A wording held as XHTML means something by its order: `a<br/>b` is two lines.
  it('keeps text and elements in the order they were written', () => {
    const root = parseXml('<p>un<br/>deux &amp; <![CDATA[<trois>]]><i>quatre</i></p>')
    expect(root.content.map((part) => (typeof part === 'string' ? part : `<${part.name}>`))).toEqual([
      'un',
      '<br>',
      'deux & <trois>',
      '<i>'
    ])
  })

  it('decodes the text and the attributes', () => {
    const root = parseXml('<a t="3 &lt; 5">R&amp;D</a>')
    expect(root.attrs.t).toBe('3 < 5')
    expect(root.text).toBe('R&D')
  })

  it('skips comments and reads CDATA as the text it is', () => {
    expect(parseXml('<a><!-- ignoré --><![CDATA[<pas une balise>]]></a>').text).toBe('<pas une balise>')
  })

  it('does not mind a byte-order mark in front', () => {
    expect(parseXml('﻿<a/>').name).toBe('a')
  })

  // Never a tree quietly reshaped around the mistake.
  it('refuses a closing tag that does not match, and says where', () => {
    expect(() => parseXml('<a><b></a></b>')).toThrow(XmlError)
    expect(() => parseXml('<a><b></a></b>')).toThrow(/<\/a> closes <b>/)
  })

  it('refuses an element that is never closed', () => {
    expect(() => parseXml('<a><b>')).toThrow(/<b> is never closed/)
  })

  it('refuses a second root, and text outside the first', () => {
    expect(() => parseXml('<a/><b/>')).toThrow(/second root/)
    expect(() => parseXml('texte<a/>')).toThrow(/outside the root/)
  })

  it('refuses an attribute that is not quoted', () => {
    expect(() => parseXml('<a x=1/>')).toThrow(/not quoted/)
  })

  it('refuses nothing at all', () => {
    expect(() => parseXml('   ')).toThrow(/no root element/)
  })
})
