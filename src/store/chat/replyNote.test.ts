import { describe, expect, it } from 'vitest'
import { replyNoteContent, replyTitle, withoutChangeBlocks } from './replyNote'

describe('withoutChangeBlocks', () => {
  it('keeps the prose and the other code, and drops the change blocks', () => {
    const reply = [
      '# Point du 28/09',
      '',
      'Le soutènement glisse :',
      '',
      '```pm-change',
      '{"ticket": "Soutènement", "field": "due", "value": "2026-10-09"}',
      '```',
      '',
      '',
      '```ts',
      'const a = 1',
      '```',
      '',
      '~~~pm-change',
      '{"create": "Radier"}',
      '~~~',
      '',
      'Fin.'
    ].join('\n')
    expect(withoutChangeBlocks(reply)).toBe(
      ['# Point du 28/09', '', 'Le soutènement glisse :', '', '```ts', 'const a = 1', '```', '', 'Fin.'].join('\n')
    )
  })

  // A sample of a block inside another code block is the sample's, not a block to drop.
  it('leaves a change block quoted inside another code block', () => {
    const reply = '````md\n```pm-change\n{}\n```\n````'
    expect(withoutChangeBlocks(reply)).toBe(reply)
  })
})

describe('replyTitle', () => {
  it('is the reply’s first heading, or the question', () => {
    expect(replyTitle('Intro\n\n## Compte rendu **Ligne 6** — S39\n\nTexte', 'Q')).toBe('Compte rendu Ligne 6 — S39')
    expect(replyTitle('Pas de titre.', 'Rédige le compte rendu')).toBe('Rédige le compte rendu')
    const long = replyTitle(
      '',
      'Compare ce planning avec les tickets du projet, tâche par tâche et jusqu’à la dernière'
    )
    expect(long).toBe('Compare ce planning avec les tickets du projet, tâche par tâche et jusqu’à la…')
  })
})

describe('replyNoteContent', () => {
  it('says where the note came from, then gives the reply', () => {
    expect(
      replyNoteContent(
        {
          created: '2026-09-28T12:00:00.000Z',
          model: 'qwen3',
          chat: 'Chats/2026-09-28 14h00 Point.md',
          project: 'Work/Ligne 6/Ligne 6.md'
        },
        '# Point'
      )
    ).toBe(
      [
        '---',
        'created: "2026-09-28T12:00:00.000Z"',
        'project: "[[Work/Ligne 6/Ligne 6]]"',
        'chat: "[[Chats/2026-09-28 14h00 Point]]"',
        'model: "qwen3"',
        '---',
        '',
        '# Point',
        ''
      ].join('\n')
    )
  })
})
