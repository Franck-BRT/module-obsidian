import { describe, expect, it } from 'vitest'
import { decodeWords, htmlToText, isoDate, parseEml } from './parseEml'

const crlf = (text: string): string => text.replace(/\n/g, '\r\n')

describe('reading an .eml', () => {
  it('reads the envelope and the text', () => {
    const mail = parseEml(
      crlf(`From: Jean Dupont <jean@example.fr>
To: Franck <franck@blackroom.fr>
Subject: Relance sur la STB
Date: Tue, 15 Sep 2026 09:12:00 +0200

Bonjour,

Peux-tu relancer le fournisseur ?
`)
    )
    expect(mail.subject).toBe('Relance sur la STB')
    expect(mail.from).toBe('Jean Dupont <jean@example.fr>')
    expect(mail.to).toEqual(['Franck <franck@blackroom.fr>'])
    expect(mail.date).toBe('2026-09-15')
    expect(mail.body).toContain('Peux-tu relancer le fournisseur ?')
  })

  it('unfolds a header that was split across lines', () => {
    const mail = parseEml(crlf('Subject: Un sujet\n  qui continue\n\ncorps\n'))
    expect(mail.subject).toBe('Un sujet qui continue')
  })

  it('separates recipients without cutting a name on its own comma', () => {
    const mail = parseEml(crlf('To: "Dupont, Jean" <jean@x.fr>, marie@y.fr\n\n\n'))
    expect(mail.to).toEqual(['Dupont, Jean <jean@x.fr>', 'marie@y.fr'])
  })

  it('decodes an accented subject sent as an encoded word', () => {
    // What every French subject line actually looks like on the wire.
    expect(decodeWords('=?UTF-8?B?UsOpdW5pb24gZGUgY2hhbnRpZXI=?=')).toBe('Réunion de chantier')
    expect(decodeWords('=?iso-8859-1?Q?R=E9union_report=E9e?=')).toBe('Réunion reportée')
  })

  it('decodes a quoted-printable body, soft breaks and all', () => {
    const mail = parseEml(
      crlf(`Subject: x
Content-Type: text/plain; charset="utf-8"
Content-Transfer-Encoding: quoted-printable

Le d=C3=A9lai est d=C3=A9pass=C3=A9 pour la r=
=C3=A9ception.
`)
    )
    expect(mail.body).toBe('Le délai est dépassé pour la réception.')
  })

  it('decodes a base64 body', () => {
    const mail = parseEml(
      crlf(`Subject: x
Content-Type: text/plain; charset=utf-8
Content-Transfer-Encoding: base64

UsOpdW5pb24gY29uZmlybcOpZQ==
`)
    )
    expect(mail.body).toBe('Réunion confirmée')
  })

  it('prefers the plain part of a multipart message over its HTML', () => {
    const mail = parseEml(
      crlf(`Subject: x
Content-Type: multipart/alternative; boundary="B1"

--B1
Content-Type: text/plain; charset=utf-8

La version texte.
--B1
Content-Type: text/html; charset=utf-8

<p>La version HTML.</p>
--B1--
`)
    )
    expect(mail.body).toBe('La version texte.')
  })

  it('falls back to the HTML when that is all the message has', () => {
    const mail = parseEml(
      crlf(`Subject: x
Content-Type: multipart/alternative; boundary="B1"

--B1
Content-Type: text/html; charset=utf-8

<p>Bonjour,</p><p>Merci&nbsp;!</p>
--B1--
`)
    )
    expect(mail.body).toBe('Bonjour,\n\nMerci !')
  })

  it('walks into a multipart nested inside a multipart', () => {
    const mail = parseEml(
      crlf(`Subject: x
Content-Type: multipart/mixed; boundary="OUT"

--OUT
Content-Type: multipart/alternative; boundary="IN"

--IN
Content-Type: text/plain

Le vrai texte.
--IN--
--OUT
Content-Type: application/pdf; name="plan.pdf"

JVBERi0=
--OUT--
`)
    )
    expect(mail.body).toBe('Le vrai texte.')
  })

  it('survives a message with nothing but headers', () => {
    const mail = parseEml('Subject: vide')
    expect(mail.subject).toBe('vide')
    expect(mail.body).toBe('')
  })
})

describe('reducing HTML to text', () => {
  it('keeps the block breaks and drops the rest', () => {
    expect(htmlToText('<div>Un</div><div>Deux</div>')).toBe('Un\nDeux')
    expect(htmlToText('<ul><li>A</li><li>B</li></ul>')).toBe('- A\n- B')
    expect(htmlToText('<style>p{color:red}</style><p>Texte</p>')).toBe('Texte')
  })
})

describe('the day a message was sent', () => {
  it('reads an RFC date and gives up quietly on anything else', () => {
    expect(isoDate('Tue, 15 Sep 2026 09:12:00 +0200')).toBe('2026-09-15')
    expect(isoDate('pas une date')).toBe('')
    expect(isoDate('')).toBe('')
  })
})

describe('the files an .eml carries', () => {
  const eml = (...lines: string[]): string => lines.join('\r\n')

  it('reads an attachment beside the text, and leaves the text alone', () => {
    const raw = eml(
      'Subject: Devis',
      'Content-Type: multipart/mixed; boundary="B"',
      '',
      '--B',
      'Content-Type: text/plain; charset=utf-8',
      '',
      'Ci-joint le devis.',
      '--B',
      'Content-Type: application/pdf; name="Devis.pdf"',
      'Content-Disposition: attachment; filename="Devis toiture.pdf"',
      'Content-Transfer-Encoding: base64',
      '',
      'JVBERi0xLjc=',
      '--B--',
      ''
    )
    const mail = parseEml(raw)
    expect(mail.body).toBe('Ci-joint le devis.')
    expect(mail.attachments).toHaveLength(1)
    expect(mail.attachments[0]).toMatchObject({ name: 'Devis toiture.pdf', mime: 'application/pdf', size: 8 })
    expect(new TextDecoder().decode(mail.attachments[0].bytes)).toBe('%PDF-1.7')
  })

  /**
   * The text and the HTML a message is made of name no file. That is exactly what tells
   * them from a .txt someone actually attached — which does, and must be listed.
   */
  it('does not mistake the message own parts for attachments', () => {
    const raw = eml(
      'Content-Type: multipart/alternative; boundary="B"',
      '',
      '--B',
      'Content-Type: text/plain; charset=utf-8',
      '',
      'Bonjour.',
      '--B',
      'Content-Type: text/html; charset=utf-8',
      '',
      '<p>Bonjour.</p>',
      '--B--',
      ''
    )
    expect(parseEml(raw).attachments).toEqual([])
  })

  it('lists a text file that was genuinely attached', () => {
    const raw = eml(
      'Content-Type: multipart/mixed; boundary="B"',
      '',
      '--B',
      'Content-Type: text/plain; charset=utf-8',
      '',
      'Voir le relevé.',
      '--B',
      'Content-Type: text/plain; charset=utf-8',
      'Content-Disposition: attachment; filename="releve.txt"',
      '',
      'ligne 1',
      '--B--',
      ''
    )
    expect(parseEml(raw).attachments.map((a) => a.name)).toEqual(['releve.txt'])
  })

  it('takes the name off the content type when no disposition says one', () => {
    const raw = eml(
      'Content-Type: multipart/mixed; boundary="B"',
      '',
      '--B',
      'Content-Type: text/plain',
      '',
      'Texte.',
      '--B',
      'Content-Type: image/png; name="plan.png"',
      'Content-Transfer-Encoding: base64',
      '',
      'iVBORw0KGgo=',
      '--B--',
      ''
    )
    expect(parseEml(raw).attachments[0]).toMatchObject({ name: 'plan.png', mime: 'image/png' })
  })

  /** A French file name arrives as an encoded word like any other header text. */
  it('decodes a name that was encoded to survive the headers', () => {
    const raw = eml(
      'Content-Type: multipart/mixed; boundary="B"',
      '',
      '--B',
      'Content-Type: text/plain',
      '',
      'Texte.',
      '--B',
      'Content-Type: application/pdf',
      'Content-Disposition: attachment; filename="=?utf-8?B?UsOpY2VwdGlvbi5wZGY=?="',
      '',
      'x',
      '--B--',
      ''
    )
    expect(parseEml(raw).attachments[0].name).toBe('Réception.pdf')
  })

  it('finds an attachment nested in a part of its own', () => {
    const raw = eml(
      'Content-Type: multipart/mixed; boundary="OUT"',
      '',
      '--OUT',
      'Content-Type: multipart/alternative; boundary="IN"',
      '',
      '--IN',
      'Content-Type: text/plain',
      '',
      'Bonjour.',
      '--IN--',
      '--OUT',
      'Content-Type: application/pdf',
      'Content-Disposition: attachment; filename="a.pdf"',
      '',
      'x',
      '--OUT--',
      ''
    )
    expect(parseEml(raw).attachments.map((a) => a.name)).toEqual(['a.pdf'])
  })

  it('says a plain message carries nothing', () => {
    expect(parseEml('Subject: Salut\r\n\r\nRien de joint.').attachments).toEqual([])
  })
})
