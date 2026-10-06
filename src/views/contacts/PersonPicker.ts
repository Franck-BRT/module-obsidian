import { setIcon, SuggestModal, type App } from 'obsidian'
import type { Contact, ContactBook } from '../../store/contacts'
import { fold } from '../../store/library/libraryDoc'
import type { ProjectPeople } from '../../store/projectPeople'
import { t } from '../../i18n'

/** One the picker offers: a contact of the people folder, or a name the project writes that none stands for. */
export interface PersonChoice {
  name: string
  contact: Contact | null
  onProject: boolean
}

/**
 * Someone of the people folder, found by name, company, role or mail — those the project
 * declares only, at first, when it declares any; the box above the list shows everyone.
 */
export class PersonPicker extends SuggestModal<PersonChoice> {
  private onlyProject: boolean
  private choices: PersonChoice[]

  constructor(
    app: App,
    book: ContactBook,
    people: ProjectPeople,
    private onChoose: (choice: PersonChoice) => void
  ) {
    super(app)
    this.choices = [
      ...book.contacts.map((contact) => ({
        name: contact.name,
        contact,
        onProject: people.contacts.has(contact.path)
      })),
      ...people.unknown.map((name) => ({ name, contact: null, onProject: true }))
    ].sort((a, b) => Number(b.onProject) - Number(a.onProject) || a.name.localeCompare(b.name))
    this.onlyProject = this.choices.some((choice) => choice.onProject)
    this.setPlaceholder(t('person.search'))
  }

  async onOpen(): Promise<void> {
    await super.onOpen()
    this.modalEl.addClass('pm-person-picker')
    const bar = createDiv({ cls: 'pm-person-picker-bar' })
    const label = bar.createEl('label')
    const box = label.createEl('input', { attr: { type: 'checkbox' } })
    box.checked = this.onlyProject
    label.appendText(` ${t('person.onlyProject')}`)
    box.addEventListener('change', () => {
      this.onlyProject = box.checked
      // The list drawn again, as for a letter typed.
      this.inputEl.dispatchEvent(new Event('input'))
    })
    this.inputEl.parentElement?.after(bar)
  }

  getSuggestions(query: string): PersonChoice[] {
    const words = fold(query).split(/\s+/).filter(Boolean)
    return this.choices.filter((choice) => {
      if (this.onlyProject && !choice.onProject) return false
      const contact = choice.contact
      const haystack = fold(
        [choice.name, contact?.company, contact?.role, contact?.email, ...(contact?.aliases ?? [])].join(' ')
      )
      return words.every((word) => haystack.includes(word))
    })
  }

  renderSuggestion(choice: PersonChoice, el: HTMLElement): void {
    const line = el.createDiv({ cls: 'pm-person-pick' })
    setIcon(
      line.createSpan({ cls: 'pm-person-pick-icon' }),
      choice.contact?.kind === 'company' ? 'building-2' : choice.contact ? 'user' : 'user-x'
    )
    const text = line.createDiv({ cls: 'pm-person-pick-text' })
    text.createDiv({ cls: 'pm-person-pick-name', text: choice.name })
    const contact = choice.contact
    const detail = contact
      ? [contact.kind === 'person' ? contact.company : '', contact.role, contact.email].filter(Boolean).join(' · ')
      : t('person.notInBook')
    if (detail) text.createDiv({ cls: 'pm-person-pick-detail', text: detail })
    if (choice.onProject) line.createSpan({ cls: 'pm-person-pick-tag', text: t('person.onProject') })
  }

  onChooseSuggestion(choice: PersonChoice): void {
    this.onChoose(choice)
  }
}
