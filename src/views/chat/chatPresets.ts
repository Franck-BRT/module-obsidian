import type { ChatPrompt, PromptScope } from '../../store/chat/chatPrompts'
import { t } from '../../i18n'

/**
 * The questions the plugin ships, in the reader's language.
 *
 * Each says what a good answer holds rather than only what it is about: "fais le point"
 * alone gets a paragraph, and the reader wanted what is late, what it holds up and what
 * to do first.
 */
export function builtinPrompts(): ChatPrompt[] {
  const prompt = (scope: PromptScope, label: string, question: string): ChatPrompt => ({
    label,
    question,
    scope,
    own: false
  })
  return [
    prompt('selection', t('chat.preset.rephrase'), t('chat.preset.rephraseQ')),
    prompt('selection', t('chat.preset.shorten'), t('chat.preset.shortenQ')),
    prompt('selection', t('chat.preset.proofread'), t('chat.preset.proofreadQ')),
    prompt('selection', t('chat.preset.explain'), t('chat.preset.explainQ')),
    prompt('selection', t('chat.preset.toRequirements'), t('chat.preset.toRequirementsQ')),
    prompt('selection', t('chat.preset.translateSelection'), t('chat.preset.translateSelectionQ')),
    prompt('planning', t('chat.preset.planning'), t('chat.preset.planningQ')),
    prompt('project', t('chat.preset.status'), t('chat.preset.statusQ')),
    prompt('project', t('chat.preset.late'), t('chat.preset.lateQ')),
    prompt('project', t('chat.preset.report'), t('chat.preset.reportQ')),
    prompt('project', t('chat.preset.since'), t('chat.preset.sinceQ')),
    prompt('project', t('chat.preset.person'), t('chat.preset.personQ')),
    prompt('project', t('chat.preset.risks'), t('chat.preset.risksQ')),
    prompt('project', t('chat.preset.riskRegister'), t('chat.preset.riskRegisterQ')),
    prompt('project', t('chat.preset.chase'), t('chat.preset.chaseQ')),
    prompt('project', t('chat.preset.load'), t('chat.preset.loadQ')),
    prompt('requirements', t('chat.preset.verifiable'), t('chat.preset.verifiableQ')),
    prompt('requirements', t('chat.preset.coherence'), t('chat.preset.coherenceQ')),
    prompt('requirements', t('chat.preset.verification'), t('chat.preset.verificationQ')),
    prompt('requirements', t('chat.preset.translate'), t('chat.preset.translateQ')),
    prompt('requirements', t('chat.preset.translateTo'), t('chat.preset.translateToQ')),
    prompt('file', t('chat.preset.document'), t('chat.preset.documentQ')),
    { ...prompt('file', t('chat.preset.deadlines'), t('chat.preset.deadlinesQ')), tickets: true },
    { ...prompt('file', t('chat.preset.compare'), t('chat.preset.compareQ')), tickets: true },
    prompt('note', t('chat.preset.summary'), t('chat.preset.summaryQ')),
    { ...prompt('note', t('chat.preset.actionTickets'), t('chat.preset.actionTicketsQ')), tickets: true },
    prompt('note', t('chat.preset.actions'), t('chat.preset.actionsQ')),
    prompt('note', t('chat.preset.extract'), t('chat.preset.extractQ'))
  ]
}

/**
 * Whether a ready question proposes tickets to make — the projects of its note then go
 * with it —: one shipped so, or the reader's copy of it, known by its question.
 */
export function makesTickets(prompt: ChatPrompt): boolean {
  return !!prompt.tickets || builtinPrompts().some((one) => one.tickets && one.question === prompt.question)
}

/** What each kind of question is about, in the word the settings list takes. */
export function scopeWord(scope: PromptScope): string {
  switch (scope) {
    case 'project':
      return t('chat.presetScope.project')
    case 'requirements':
      return t('chat.presetScope.requirements')
    case 'note':
      return t('chat.presetScope.note')
    case 'file':
      return t('chat.presetScope.file')
    case 'planning':
      return t('chat.presetScope.planning')
    case 'selection':
      return t('chat.presetScope.selection')
    case 'any':
      return ''
  }
}

export function scopeIcon(scope: PromptScope): string {
  switch (scope) {
    case 'project':
      return 'folder-kanban'
    case 'requirements':
      return 'list-checks'
    case 'note':
      return 'file-text'
    case 'file':
      return 'paperclip'
    case 'planning':
      return 'calendar-sync'
    case 'selection':
      return 'text-select'
    case 'any':
      return 'message-circle'
  }
}

/** A question as a line of the settings list, so a shipped one can be copied and adjusted. */
export function promptLine(prompt: ChatPrompt): string {
  const word = scopeWord(prompt.scope)
  const named = prompt.label !== prompt.question ? `${prompt.label} :: ` : ''
  return `${word ? `${word} : ` : ''}${named}${prompt.question}`
}
