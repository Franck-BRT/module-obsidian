import { describe, expect, it } from 'vitest'
import { calledSkills, isSkill, readSkill, skillBody, skillNote, skillsContext, type Skill } from './skills'

const skill = (over: Partial<Skill>): Skill => ({
  path: 's.md',
  name: 'S',
  description: '',
  triggers: [],
  folder: '',
  ...over
})

describe('readSkill', () => {
  it('reads a skill’s note by its flag, in either language', () => {
    expect(
      readSkill('Chats/Skills/CR.md', 'CR', {
        'pm-skill': true,
        nom: 'Compte rendu de réunion',
        description: 'Rédige un compte rendu',
        déclencheurs: 'compte rendu, CR, Réunion',
        dossier: 'Work/CR'
      })
    ).toEqual({
      path: 'Chats/Skills/CR.md',
      name: 'Compte rendu de réunion',
      description: 'Rédige un compte rendu',
      triggers: ['compte rendu', 'cr', 'reunion'],
      folder: 'Work/CR'
    })
    expect(readSkill('a.md', 'Synthèse', { 'pm-skill': true, triggers: ['synthèse', 3] })).toMatchObject({
      name: 'Synthèse',
      triggers: ['synthese'],
      folder: ''
    })
  })

  it('is not a skill without its flag', () => {
    expect(readSkill('a.md', 'a', { 'pm-skill': 'true' })).toBeNull()
    expect(isSkill(null)).toBe(false)
  })
})

describe('calledSkills', () => {
  const cr = skill({ name: 'CR', triggers: ['compte rendu', 'cr'] })
  const decision = skill({ name: 'Décision', triggers: ['decision', 'arbitrage'] })

  it('hears a skill’s words and phrases in a question, whole, whatever the case and accents', () => {
    expect(calledSkills([cr, decision], 'Fais le CR de la réunion').map((s) => s.name)).toEqual(['CR'])
    expect(calledSkills([cr, decision], 'Rédige un compte-rendu puis la DÉCISION').map((s) => s.name)).toEqual([
      'CR',
      'Décision'
    ])
    expect(calledSkills([cr, decision], 'Regarde cet écran')).toEqual([])
    expect(calledSkills([skill({ triggers: [] })], 'cr')).toEqual([])
  })
})

describe('skillBody', () => {
  it('is the note without its properties', () => {
    expect(skillBody('---\npm-skill: true\n---\n\n# Consignes\n\nSois bref.\n')).toBe('# Consignes\n\nSois bref.')
    expect(skillBody('Sans propriétés.')).toBe('Sans propriétés.')
    expect(skillBody('---\r\npm-skill: true\r\n---\r\nTexte')).toBe('Texte')
  })
})

describe('skillsContext', () => {
  it('gives each skill in use with its name, its folder and what it says, and leaves out an empty one', () => {
    const words = {
      heading: (name: string) => `Compétence : ${name}`,
      folder: (folder: string) => `Dossier : ${folder}`
    }
    expect(
      skillsContext(
        [
          { skill: skill({ name: 'CR', folder: 'Work/CR' }), body: 'Trois rubriques.' },
          { skill: skill({ name: 'Vide' }), body: '' }
        ],
        words
      )
    ).toBe('Compétence : CR\nDossier : Work/CR\n<skill name="CR">\nTrois rubriques.\n</skill>')
  })
})

describe('skillNote', () => {
  it('writes a skill’s properties, then its instructions, and reads back as one', async () => {
    const note = skillNote({
      name: 'CR',
      description: 'Compte rendu',
      triggers: ['cr', 'compte rendu'],
      folder: 'Work/CR',
      body: '# Consignes\n'
    })
    expect(note).toBe(
      '---\npm-skill: true\ndescription: Compte rendu\ntriggers:\n  - cr\n  - compte rendu\nfolder: Work/CR\n---\n\n# Consignes\n'
    )
    const { parseYaml } = await import('obsidian')
    const fm: unknown = parseYaml(note.split('---')[1])
    expect(readSkill('CR.md', 'CR', fm)).toMatchObject({ triggers: ['cr', 'compte rendu'], folder: 'Work/CR' })
  })
})

describe('the shipped French skills', () => {
  it('are called by the requests they are for, and each says how to propose its note', async () => {
    const { fr } = await import('../../i18n/fr')
    const text = (key: keyof typeof fr): string => {
      const value = fr[key]
      if (typeof value !== 'string') throw new Error(`${String(key)} is not one text`)
      return value
    }
    const shipped = (['minutes', 'summary', 'decision', 'log'] as const).map((key) =>
      skill({
        name: key,
        triggers: text(`skill.example.${key}.triggers`)
          .split(',')
          .map((word) => word.trim().toLowerCase())
          .map((word) => word.normalize('NFD').replace(/[̀-ͯ]/g, ''))
      })
    )
    const called = (question: string): string[] => calledSkills(shipped, question).map((s) => s.name)
    expect(called('Fais le CR de la réunion de chantier de ce matin')).toEqual(['minutes'])
    expect(called('Peux-tu résumer ? Fais-en une synthèse.')).toEqual(['summary'])
    expect(called('Il faut trancher entre les deux options')).toEqual(['decision'])
    expect(called('Ajoute au journal de chantier : béton coulé')).toEqual(['log'])
    expect(called('Quand le radier est-il coulé ?')).toEqual([])
    for (const key of ['minutes', 'summary', 'decision', 'log'] as const) {
      expect(text(`skill.example.${key}.body`)).toContain('pm-note')
    }
  })
})
