import { describe, expect, it } from 'vitest'
import { availablePrompts, parsePrompts, type ChatPrompt } from './chatPrompts'

describe('parsePrompts', () => {
  it('reads one question a line, with what it is about and a short name where given', () => {
    expect(
      parsePrompts(
        [
          'projet : Point hebdo :: Fais le point de la semaine pour le comité.',
          '  Exigences: Rends-les vérifiables.',
          'note : Résume :: Résume cette note.',
          'Traduis ta dernière réponse en anglais.',
          '',
          '# une remarque, pas une question'
        ].join('\n')
      )
    ).toEqual([
      { label: 'Point hebdo', question: 'Fais le point de la semaine pour le comité.', scope: 'project', own: true },
      { label: 'Rends-les vérifiables.', question: 'Rends-les vérifiables.', scope: 'requirements', own: true },
      { label: 'Résume', question: 'Résume cette note.', scope: 'note', own: true },
      {
        label: 'Traduis ta dernière réponse en anglais.',
        question: 'Traduis ta dernière réponse en anglais.',
        scope: 'any',
        own: true
      }
    ])
  })

  it('takes the English words for what a question is about', () => {
    expect(parsePrompts('project: A\nrequirements : B\nalways: C').map((prompt) => prompt.scope)).toEqual([
      'project',
      'requirements',
      'any'
    ])
  })

  // A colon in a question is part of the question unless what comes before it is one of
  // the words for what a question is about.
  it('leaves a question that happens to hold a colon alone', () => {
    expect(parsePrompts('Attention : relis tout.')).toEqual([
      { label: 'Attention : relis tout.', question: 'Attention : relis tout.', scope: 'any', own: true }
    ])
    expect(parsePrompts('Point :: Rappel : fais le point.')[0]).toMatchObject({
      label: 'Point',
      question: 'Rappel : fais le point.',
      scope: 'any'
    })
  })

  it('skips a line with a name and no question', () => {
    expect(parsePrompts('projet : Vide ::   \nprojet :')).toEqual([])
  })
})

describe('availablePrompts', () => {
  const shipped = (scope: ChatPrompt['scope'], question: string): ChatPrompt => ({
    label: question,
    question,
    scope,
    own: false
  })
  const prompts: ChatPrompt[] = [
    shipped('any', 'Tout'),
    shipped('note', 'Résume la note.'),
    shipped('project', 'Fais le point.'),
    shipped('requirements', 'Rends-les vérifiables.'),
    { label: 'Hebdo', question: 'Point hebdo.', scope: 'project', own: true },
    { label: 'Copie', question: 'fais le  point.', scope: 'project', own: true }
  ]

  it('offers only what fits what is attached, the most particular first', () => {
    expect(
      availablePrompts(prompts, { note: true, project: false, requirements: false, file: false, selection: false }).map(
        (prompt) => prompt.question
      )
    ).toEqual(['Résume la note.', 'Tout'])
    expect(
      availablePrompts(prompts, { note: false, project: false, requirements: true, file: false, selection: false }).map(
        (prompt) => prompt.question
      )
    ).toEqual(['Rends-les vérifiables.', 'Tout'])
  })

  // The reader's own first within a group, and a shipped question they copied only once.
  it('puts the reader’s own first, and offers one question once', () => {
    expect(
      availablePrompts(prompts, { note: false, project: true, requirements: false, file: false, selection: false }).map(
        (prompt) => prompt.question
      )
    ).toEqual(['Point hebdo.', 'fais le  point.', 'Tout'])
  })
})

describe('a planning question', () => {
  const prompts = parsePrompts('planning : Mets à jour\nfichier : Résume le document\nprojet : Point')

  // A file read against a project: offered only with both, before anything else.
  it('is offered only with a file and a project, first', () => {
    const offered = (file: boolean, project: boolean): string[] =>
      availablePrompts(prompts, { note: false, requirements: false, file, project, selection: false }).map(
        (prompt) => prompt.question
      )
    expect(offered(true, true)).toEqual(['Mets à jour', 'Point', 'Résume le document'])
    expect(offered(true, false)).toEqual(['Résume le document'])
    expect(offered(false, true)).toEqual(['Point'])
  })
})

describe('a question about a passage', () => {
  // The passage chosen is what the reader wants to talk about now: its questions first.
  it('is offered with a passage chosen, before any other', () => {
    const prompts = parsePrompts('sélection : Reformule.\nprojet : Point\nTout')
    const offered = (selection: boolean): string[] =>
      availablePrompts(prompts, { note: false, requirements: false, file: false, project: true, selection }).map(
        (prompt) => prompt.question
      )
    expect(offered(true)).toEqual(['Reformule.', 'Point', 'Tout'])
    expect(offered(false)).toEqual(['Point', 'Tout'])
  })
})
