import { TFile, type App } from 'obsidian'
import { beforeEach, describe, expect, it } from 'vitest'
import { makeFakeApp, type FakeVault } from '../../../test/fakeVault'
import {
  appendProposal,
  appendTarget,
  holdsProposal,
  newNoteContent,
  noteAtTitle,
  noteBlocks,
  appendToSection,
  sectionFor,
  underSection,
  parseNoteProposal,
  findSection,
  replaceSection,
  sectionText,
  sectionTitles,
  safeFolder,
  writeProposedNote,
  writtenNote
} from './noteProposal'

const BLOCK = `titre: Compte rendu réunion 12
Dossier : Work/Génie civil/CR
Étiquettes: cr, chantier
---
# Compte rendu réunion 12

- Radier décalé au 19/10.`

describe('parseNoteProposal', () => {
  it('reads the header — in either language, whatever the case and accents — then the note', () => {
    expect(parseNoteProposal(BLOCK)).toEqual({
      title: 'Compte rendu réunion 12',
      folder: 'Work/Génie civil/CR',
      append: '',
      clean: '',
      replace: '',
      section: '',
      tags: ['cr', 'chantier'],
      body: '# Compte rendu réunion 12\n\n- Radier décalé au 19/10.'
    })
    expect(parseNoteProposal('title: "Minutes"\nfolder: Notes\n---\nText')).toMatchObject({
      title: 'Minutes',
      folder: 'Notes',
      body: 'Text'
    })
  })

  it('takes a note with no header whole, titled by its first heading', () => {
    expect(parseNoteProposal('# Décision radier\n\nOn décale.')).toMatchObject({
      title: 'Décision radier',
      folder: '',
      body: '# Décision radier\n\nOn décale.'
    })
  })

  it('does not take a note’s own rule for the end of a header', () => {
    const note = '# Synthèse\n\nPremière partie.\n\n---\n\nSeconde partie.'
    expect(parseNoteProposal(note)?.body).toBe(note)
  })

  it('reads the note to add to', () => {
    expect(parseNoteProposal('ajouter à: [[Journal de chantier]]\n---\n## 29/09\nBéton coulé.')).toMatchObject({
      title: '',
      append: '[[Journal de chantier]]',
      body: '## 29/09\nBéton coulé.'
    })
  })

  it('reads the note whose transcription is to be cleaned, with no rule nor body', () => {
    expect(parseNoteProposal('nettoyer: [[S-7-212-V1]]')).toMatchObject({ clean: '[[S-7-212-V1]]', body: '' })
    expect(parseNoteProposal('Clean: Planning scanné\n---\n')).toMatchObject({ clean: 'Planning scanné' })
    // A note that only says the word is a note.
    expect(parseNoteProposal('# Nettoyer\n\nnettoyer: le chantier')?.clean).toBe('')
  })

  it('has nothing to write without a body, or without a title or a note to add to', () => {
    expect(parseNoteProposal('titre: Vide\n---\n')).toBeNull()
    expect(parseNoteProposal('Du texte sans titre.')).toBeNull()
  })
})

describe('safeFolder', () => {
  it('keeps a folder inside the vault, each part a name a file system takes', () => {
    expect(safeFolder('/Work/../Génie civil/CR:12/')).toBe('Work/Génie civil/CR-12')
    expect(safeFolder('  ')).toBe('')
    expect(safeFolder('..\\..')).toBe('')
  })
})

describe('newNoteContent', () => {
  it('writes the tags and the conversation it came from as properties, then the note', () => {
    const proposal = parseNoteProposal(BLOCK)
    if (!proposal) throw new Error('unread')
    expect(newNoteContent(proposal, 'Chats/2026-09-29 Réunion.md')).toBe(
      '---\ntags:\n  - cr\n  - chantier\nchat: "[[Chats/2026-09-29 Réunion]]"\n---\n\n# Compte rendu réunion 12\n\n- Radier décalé au 19/10.\n'
    )
    expect(newNoteContent({ ...proposal, tags: [] }, '')).toBe(
      '# Compte rendu réunion 12\n\n- Radier décalé au 19/10.\n'
    )
  })

  it('knows a note that already holds the text, however it was wrapped', () => {
    const proposal = parseNoteProposal('# A\n\nun  deux\ntrois')
    if (!proposal) throw new Error('unread')
    expect(holdsProposal('---\nx: 1\n---\n# A\nun deux trois\n', proposal)).toBe(true)
    expect(holdsProposal('# A\nun deux', proposal)).toBe(false)
  })
})

describe('writing a proposed note', () => {
  let vault: FakeVault
  let app: App

  beforeEach(() => {
    const fake = makeFakeApp({ liveMetadataCache: true })
    vault = fake.vault
    app = fake.app as unknown as App
  })

  it('writes it in its folder, never over another note, and knows it was written', async () => {
    const proposal = parseNoteProposal(BLOCK)
    if (!proposal) throw new Error('unread')
    expect(await writtenNote(app, proposal, 'Notes')).toBeNull()
    await vault.create('Work/Génie civil/CR/Compte rendu réunion 12.md', 'Une autre note')
    const file = await writeProposedNote(app, proposal, 'Notes', '')
    expect(file.path).toBe('Work/Génie civil/CR/Compte rendu réunion 12-1.md')
    expect((await writtenNote(app, proposal, 'Notes'))?.path).toBe(file.path)
  })

  it('writes a note naming no folder in the one given for the chat’s notes, or at the root', async () => {
    const proposal = parseNoteProposal('# Décision\n\nOn décale.')
    if (!proposal) throw new Error('unread')
    expect((await writeProposedNote(app, proposal, 'Notes/Chat', '')).path).toBe('Notes/Chat/Décision.md')
    expect((await writeProposedNote(app, proposal, '', '')).path).toBe('Décision.md')
  })

  it('finds the note of the proposed name already there, whatever it says, and none for a free name', async () => {
    const proposal = parseNoteProposal(BLOCK)
    if (!proposal) throw new Error('unread')
    expect(noteAtTitle(app, proposal, 'Notes')).toBeNull()
    await vault.create('Work/Génie civil/CR/Compte rendu réunion 12.md', '# Compte rendu réunion 12\n\nAncien texte.')
    expect(noteAtTitle(app, proposal, 'Notes')?.path).toBe('Work/Génie civil/CR/Compte rendu réunion 12.md')
  })

  it('adds to the note it names, found as a link is', async () => {
    const journal = await vault.create('Work/Journal de chantier.md', '# Journal\n\n## 28/09\nFerraillage.\n')
    const proposal = parseNoteProposal('ajouter à: [[Journal de chantier]]\n---\n## 29/09\nBéton coulé.')
    if (!proposal) throw new Error('unread')
    const target = appendTarget(app, proposal, 'Chats/c.md')
    expect(target?.path).toBe('Work/Journal de chantier.md')
    if (!(target instanceof TFile)) throw new Error('no target')
    await appendProposal(app, target, proposal)
    expect(vault.contentAt(journal.path)).toBe('# Journal\n\n## 28/09\nFerraillage.\n\n## 29/09\nBéton coulé.\n')
    expect(appendTarget(app, { ...proposal, append: '[[Nulle part]]' }, 'Chats/c.md')).toBeNull()
  })
})

describe('a section of a note rewritten', () => {
  const note = [
    '---',
    'tags: [cr]',
    '---',
    '# Réunion 12',
    '',
    '## Présents',
    '',
    'Anne, Paul.',
    '',
    '## Décisions',
    '',
    '- Radier décalé.',
    '',
    '### Détail',
    '',
    'Fournisseur en retard.',
    '',
    '```',
    '## Pas un titre',
    '```',
    '',
    '## Suite',
    '',
    'À voir.',
    ''
  ].join('\n')

  it('reads the proposal: the note, the section, the new text, which may be nothing', () => {
    expect(
      parseNoteProposal('remplacer dans: [[Réunion 12]]\nsection: Décisions\n---\n- Radier décalé au 20/10.')
    ).toMatchObject({
      replace: '[[Réunion 12]]',
      section: 'Décisions',
      body: '- Radier décalé au 20/10.'
    })
    expect(parseNoteProposal('replace in: Réunion 12\nsection: Suite\n---\n')).toMatchObject({
      replace: 'Réunion 12',
      body: ''
    })
  })

  it('finds a section by its heading, whatever its case and accents, down to the next one of its level', () => {
    expect(sectionTitles(note)).toEqual(['Réunion 12', 'Présents', 'Décisions', 'Détail', 'Suite'])
    expect(sectionText(note, 'decisions')).toBe(
      '- Radier décalé.\n\n### Détail\n\nFournisseur en retard.\n\n```\n## Pas un titre\n```'
    )
    expect(sectionText(note, '## Présents')).toBe('Anne, Paul.')
    expect(findSection(note, 'Absent')).toBeNull()
    expect(sectionText(note, '')).toContain('# Réunion 12')
    expect(sectionText(note, '')).not.toContain('tags:')
  })

  it('replaces the section’s text, its heading and the rest kept; or the whole text, its properties kept', () => {
    const after = replaceSection(note, 'Décisions', '- Radier décalé au 20/10.')
    expect(after).toContain('## Décisions\n\n- Radier décalé au 20/10.\n\n## Suite\n\nÀ voir.')
    expect(after).not.toContain('Fournisseur')
    expect(after?.startsWith('---\ntags: [cr]\n---\n# Réunion 12')).toBe(true)
    expect(sectionText(after ?? '', 'Décisions')).toBe('- Radier décalé au 20/10.')
    expect(replaceSection(note, 'Suite', '')).toMatch(/## Suite\n$/)
    expect(replaceSection(note, '', '# Nouveau\n\nTexte.')).toBe('---\ntags: [cr]\n---\n\n# Nouveau\n\nTexte.\n')
    expect(replaceSection(note, 'Absent', 'x')).toBeNull()
  })
})

describe('the note blocks of a reply', () => {
  it('are read between their fences, of three backticks or four, the rest of the reply aside', () => {
    const reply = [
      'Voici l’analyse.',
      '````pm-note',
      'titre: Analyse CCTG',
      '---',
      '# Analyse CCTG',
      '```',
      'code',
      '```',
      '````',
      'Et un ajout :',
      '```pm-note',
      'ajouter à: [[Journal]]',
      '---',
      'Ligne.',
      '```'
    ].join('\n')
    expect(noteBlocks(reply)).toEqual([
      'titre: Analyse CCTG\n---\n# Analyse CCTG\n```\ncode\n```\n',
      'ajouter à: [[Journal]]\n---\nLigne.\n'
    ])
    expect(noteBlocks('Rien à proposer.')).toEqual([])
  })
})

describe('text added to a section of a note', () => {
  // The note and the addition of a real exchange: the deepening asked for went to the end.
  const NOTE =
    "# Analyse du CCTG Lot 02 Gros œuvre\n\n## Contexte\nLe document définit les conditions d'exécution des travaux de gros œuvre pour le bâtiment technique B12, incluant terrassements, fondations, voiles, poteaux et dalles en béton armé.\n\n## Points clés\n\n### Objet et étendue\n- **Inclus** : Terrassements, fondations, radier, voiles, poteaux, dalles.\n- **Exclus** : VRD, étanchéité, charpente métallique (lots 01, 03, 04).\n\n### Bétons\n- **Classes d'exposition** :\n  - XC2 pour ouvrages enterrés.\n  - XC4 et XF1 pour extérieurs.\n  - XA1 pour le radier de la salle des groupes (agressivité chimique faible).\n- **Résistances** :\n  - C25/30 pour fondations.\n  - C30/37 pour voiles, poteaux, dalles.\n  - C35/45 pour le radier.\n- **Essais** :\n  - Épreuves de convenance avant premier coulage.\n  - 3 éprouvettes par 50 m³ ou par jour de bétonnage.\n- **Conditions météo** :\n  - Interdiction de bétonnage si température < 5 °C ou > 30 °C, sauf dispositions validées.\n\n### Armatures\n- **Nuance** : B500B, certifiées NF.\n- **Enrobages** :\n  - 30 mm intérieurs.\n  - 40 mm extérieurs.\n  - 50 mm contre terre.\n- **Validation** : Plans soumis au bureau de contrôle 15 jours avant ferraillage.\n\n### Coffrages et décoffrage\n- **Classe** : P3 pour parements vus.\n- **Délais** :\n  - 24 heures pour voiles.\n  - 7 jours pour dalles sans étaiement.\n\n### Tolérances\n- **Planéité** :\n  - 7 mm sous règle de 2 m pour dalles avec revêtement collé.\n  - 5 mm pour salle des groupes (radier recevant massifs).\n\n### Réservations\n- **Implantation** : D'après plans de synthèse visés.\n- **Oubli** : Reprise par carottage aux frais de l'entreprise.\n\n### Documents\n- **À remettre** :\n  - PAQ 4 semaines avant démarrage.\n  - Fiches techniques avant coulage.\n  - Procès-verbaux d'essais au fil de l'eau.\n  - DOE dans le mois suivant réception.\n\n### Réception des supports\n- **Fonds de fouille** : Réception contradictoire avec géotechnicien (mission G3), PV par zone."
  const ADDED =
    "## Approfondissement : Article 2 - Bétons\n\n### Fabrication et transport\n- **Origine** : Centrale certifiée NF.\n- **Délai** : Maximum 90 minutes entre malaxage et mise en œuvre.\n- **Interdiction** : Ajout d'eau sur chantier.\n\n### Essais\n- **Fréquence** :\n  - Épreuves de convenance avant premier coulage de chaque classe.\n  - 3 éprouvettes par tranche de 50 m³ ou par jour de bétonnage.\n- **Transmission** : Résultats au maître d'œuvre sous 30 jours.\n\n### Bétonnage par temps froid ou chaud\n- **Plage autorisée** : 5 °C à 30 °C.\n- **Exceptions** : Dispositions particulières (adjuvants, protection thermique, cure renforcée) validées par le maître d'œuvre."

  it('finds the section the addition is about from its heading, the note’s own title aside', () => {
    expect(sectionFor(NOTE, ADDED)).toBe('Bétons')
    expect(sectionFor(NOTE, '## Divers\n\nRien.')).toBeNull()
    expect(sectionFor(NOTE, 'Pas de titre.')).toBeNull()
  })

  it('goes at the end of the section, before the next one, its headings stepped under it', () => {
    const next = appendToSection(NOTE, 'Bétons', ADDED)
    if (next === null) throw new Error('not found')
    const betons = next.indexOf('### Bétons')
    const added = next.indexOf('#### Approfondissement : Article 2 - Bétons')
    const armatures = next.indexOf('### Armatures')
    expect(betons).toBeGreaterThan(0)
    expect(added).toBeGreaterThan(betons)
    expect(armatures).toBeGreaterThan(added)
    expect(next).toContain('##### Fabrication et transport')
    expect(next).toContain('Interdiction de bétonnage si température < 5 °C')
    expect(underSection(NOTE, 'Bétons', ADDED)?.split('\n')[0]).toBe('#### Approfondissement : Article 2 - Bétons')
    expect(appendToSection(NOTE, 'Nulle part', ADDED)).toBeNull()
  })

  it('is read from a block that names the note and the section', () => {
    const proposal = parseNoteProposal('ajouter à: [[Analyse]]\nsection: Bétons\n---\nTexte.')
    expect(proposal).toMatchObject({ append: '[[Analyse]]', section: 'Bétons', body: 'Texte.' })
  })
})
