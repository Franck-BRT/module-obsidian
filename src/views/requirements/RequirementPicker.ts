import { App, SuggestModal } from 'obsidian'
import type { Requirement } from '../../store/requirements/Requirement'
import { displayText } from '../../store/requirements/Requirement'
import { matchesReqSearch } from './reqFilter'
import { t } from '../../i18n'

/**
 * Choosing a requirement to quote.
 *
 * Searched across every language it is written in, like the library itself: somebody
 * drafting a French specification may well remember the requirement by its English
 * wording, and a picker that could not find it that way would send them back to the
 * library to look the identifier up by hand.
 */
class RequirementPickerModal extends SuggestModal<Requirement> {
  constructor(
    app: App,
    private library: Requirement[],
    private onChoose: (requirement: Requirement | null) => void
  ) {
    super(app)
    this.setPlaceholder(t('req.pick'))
  }

  getSuggestions(query: string): Requirement[] {
    return this.library.filter((requirement) => matchesReqSearch(requirement, query))
  }

  renderSuggestion(requirement: Requirement, el: HTMLElement): void {
    const row = el.createDiv({ cls: 'pm-picker-suggestion pm-req-suggestion' })
    row.createSpan({ cls: 'pm-req-id', text: requirement.id })
    const body = displayText(requirement, requirement.sourceLang)?.body ?? ''
    row.createSpan({ text: requirement.title || body || t('req.noWording') })
  }

  onChooseSuggestion(requirement: Requirement): void {
    this.onChoose(requirement)
  }

  onClose(): void {
    // After the choice, never instead of it: the modal closes either way and the caller
    // has a next step to abandon only when nothing was picked.
    window.setTimeout(() => this.onChoose(null), 0)
  }
}

export function pickRequirement(app: App, library: Requirement[]): Promise<Requirement | null> {
  return new Promise((resolve) => {
    let settled = false
    const done = (requirement: Requirement | null): void => {
      if (settled) return
      settled = true
      resolve(requirement)
    }
    new RequirementPickerModal(app, library, done).open()
  })
}
