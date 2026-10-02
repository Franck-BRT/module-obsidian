import { ItemView, setIcon, TFile, type ViewStateResult, type WorkspaceLeaf } from 'obsidian'
import type PMPlugin from '../../main'
import type { Project } from '../../types'
import { ContactBook, readContacts, type Contact } from '../../store/contacts'
import { contactWork, type ContactWork, type UnknownName, type WorkItem } from '../../store/contactWork'
import { flattenTasks } from '../../store/TaskTreeOps'
import { formatDateShort, today } from '../../dates'
import { openTaskModal } from '../../ui/ModalFactory'
import { EmptyState } from '../../ui/primitives/EmptyState'
import { openChase } from '../chase/ChaseModal'
import { openContactModal } from './ContactModal'
import { t } from '../../i18n'
import { safeAsync } from '../../utils'
import { explain } from '../../ui/explain'

export const PM_CONTACTS_VIEW_TYPE = 'pm-contacts'

type KindFilter = 'all' | 'company' | 'person'

/**
 * Who the projects deal with: the companies, the people working for them, and those on
 * their own — how to reach each, what they hold and what they owe, late or not —,
 * narrowed to one project when opened from it. A name the projects use and no contact
 * answers to is offered a contact of its own.
 */
export class ContactsView extends ItemView {
  private project = ''
  private search = ''
  private kind: KindFilter = 'all'
  /** The contacts whose detail is shown, by note path. */
  private expanded = new Set<string>()
  private projects: Project[] = []
  private timer: number | null = null
  private bodyEl: HTMLElement | null = null

  constructor(
    leaf: WorkspaceLeaf,
    private plugin: PMPlugin
  ) {
    super(leaf)
  }

  getViewType(): string {
    return PM_CONTACTS_VIEW_TYPE
  }

  getDisplayText(): string {
    return t('contact.title')
  }

  getIcon(): string {
    return 'contact'
  }

  getState(): Record<string, unknown> {
    return this.project ? { project: this.project } : {}
  }

  async setState(state: unknown, result: ViewStateResult): Promise<void> {
    const project = (state as { project?: unknown } | null)?.project
    this.project = typeof project === 'string' ? project : ''
    if (this.bodyEl) await this.reload()
    await super.setState(state, result)
  }

  async onOpen(): Promise<void> {
    this.containerEl.addClass('pm-view')
    this.contentEl.addClass('pm-contacts')
    const later = (): void => this.reloadSoon()
    this.registerEvent(this.app.metadataCache.on('changed', later))
    this.registerEvent(this.app.vault.on('delete', later))
    this.registerEvent(this.app.vault.on('rename', later))
    this.register(this.plugin.index.onChange(later))
    await this.reload()
  }

  onClose(): Promise<void> {
    if (this.timer !== null) window.clearTimeout(this.timer)
    return Promise.resolve()
  }

  private reloadSoon(): void {
    if (this.timer !== null) window.clearTimeout(this.timer)
    this.timer = window.setTimeout(() => {
      this.timer = null
      void this.reload()
    }, 400)
  }

  private async reload(): Promise<void> {
    const paths = this.plugin.index.projectPaths().filter((path) => {
      const ref = this.plugin.index.projectRef(path)
      return !!ref && !ref.template && !ref.program
    })
    this.projects = await this.plugin.store.loadProjects(paths)
    this.render()
  }

  private render(): void {
    const root = this.contentEl
    root.empty()
    const head = root.createDiv('pm-contacts-head')
    head.createEl('h2', { cls: 'pm-contacts-title', text: t('contact.title') })
    const add = head.createEl('button', { cls: 'mod-cta' })
    setIcon(add.createSpan({ cls: 'pm-contacts-icon' }), 'user-plus')
    add.createSpan({ text: t('contact.new') })
    explain(add, t('contact.new'), t('tip.contact.new'))
    add.addEventListener('click', () => openContactModal(this.plugin, { onDone: () => this.reloadSoon() }))
    // Who holds how much, week by week, on every project.
    const load = head.createEl('button')
    setIcon(load.createSpan({ cls: 'pm-contacts-icon' }), 'calendar-range')
    load.createSpan({ text: t('view.workload') })
    explain(load, t('view.workload'), t('tip.view.workload'))
    load.addEventListener(
      'click',
      safeAsync(() => this.plugin.router.openWorkload())
    )

    const bar = root.createDiv('pm-contacts-bar')
    const search = bar.createEl('input', {
      cls: 'pm-contacts-search',
      attr: { type: 'search', placeholder: t('contact.search') }
    })
    search.value = this.search
    search.addEventListener('input', () => {
      this.search = search.value
      this.renderBody()
    })
    const project = bar.createEl('select', { cls: 'dropdown' })
    project.createEl('option', { value: '', text: t('contact.allProjects') })
    for (const one of this.projects) project.createEl('option', { value: one.filePath, text: one.title })
    project.value = this.project
    project.addEventListener('change', () => {
      this.project = project.value
      this.app.workspace.requestSaveLayout()
      this.renderBody()
    })
    const kind = bar.createEl('select', { cls: 'dropdown' })
    kind.createEl('option', { value: 'all', text: t('contact.kind.all') })
    kind.createEl('option', { value: 'company', text: t('contact.kind.companies') })
    kind.createEl('option', { value: 'person', text: t('contact.kind.people') })
    kind.value = this.kind
    kind.addEventListener('change', () => {
      this.kind = kind.value === 'company' || kind.value === 'person' ? kind.value : 'all'
      this.renderBody()
    })
    this.bodyEl = root.createDiv('pm-contacts-body')
    this.renderBody()
  }

  private renderBody(): void {
    const body = this.bodyEl
    if (!body) return
    body.empty()
    const contacts = readContacts(this.app, this.plugin.settings.peopleFolder)
    const book = new ContactBook(contacts)
    const projects = this.projects
      .filter((one) => !this.project || one.filePath === this.project)
      .map((one) => ({
        path: one.filePath,
        title: one.title,
        tasks: flattenTasks(one.tasks).map((flat) => flat.task),
        statuses: this.plugin.store.configFor(one).statuses
      }))
    const { byContact, unknown } = contactWork(book, projects, today().toString())
    const words = this.search.trim().toLowerCase()
    const matches = (contact: Contact): boolean =>
      !words ||
      [contact.name, contact.company, contact.role, contact.email, ...contact.lots]
        .join(' ')
        .toLowerCase()
        .includes(words)
    // Narrowed to a project, only those it involves.
    const involved = (contact: Contact): boolean =>
      !this.project || (byContact.get(contact.path)?.projects.size ?? 0) > 0
    const shown = contacts.filter(
      (contact) => matches(contact) && involved(contact) && (this.kind === 'all' || contact.kind === this.kind)
    )

    if (!shown.length && !unknown.length) {
      new EmptyState(body.createDiv())
        .setIcon('👥')
        .setTitle(contacts.length ? t('contact.noneHere') : t('contact.none'))
        .setBody(t('contact.noneDesc'))
      return
    }

    // Companies, each with its people under it; then the people of no company known.
    const placed = new Set<string>()
    const companies = shown.filter((contact) => contact.kind === 'company')
    for (const company of companies) {
      const group = body.createDiv('pm-contacts-group')
      this.renderContact(group, company, byContact.get(company.path), book)
      placed.add(company.path)
      const members = book.members(company.name).filter((member) => shown.includes(member))
      if (members.length) {
        const list = group.createDiv('pm-contacts-members')
        for (const member of members) {
          this.renderContact(list, member, byContact.get(member.path), book)
          placed.add(member.path)
        }
      }
    }
    const rest = shown.filter((contact) => !placed.has(contact.path))
    if (rest.length) {
      if (companies.length) body.createEl('h3', { cls: 'pm-contacts-subtitle', text: t('contact.others') })
      const group = body.createDiv('pm-contacts-group')
      for (const contact of rest) this.renderContact(group, contact, byContact.get(contact.path), book)
    }
    if (unknown.length && !words) this.renderUnknown(body, unknown)
  }

  private renderContact(parent: HTMLElement, contact: Contact, work: ContactWork | undefined, book: ContactBook): void {
    const card = parent.createDiv(`pm-contact pm-contact--${contact.kind}`)
    const row = card.createDiv('pm-contact-row')
    setIcon(row.createSpan({ cls: 'pm-contact-icon' }), contact.kind === 'company' ? 'building-2' : 'user')
    const main = row.createDiv('pm-contact-main')
    const name = main.createEl('a', { cls: 'pm-contact-name', href: '#', text: contact.name })
    name.addEventListener('click', (event) => {
      event.preventDefault()
      const file = this.app.vault.getAbstractFileByPath(contact.path)
      if (file instanceof TFile) void this.app.workspace.getLeaf('tab').openFile(file)
    })
    const line = [contact.role, contact.kind === 'person' && !book.find(contact.company) ? contact.company : '']
      .filter(Boolean)
      .join(' · ')
    if (line) main.createDiv({ cls: 'pm-contact-line', text: line })
    const reach = main.createDiv('pm-contact-reach')
    if (contact.email) reach.createEl('a', { href: `mailto:${contact.email}`, text: contact.email })
    if (contact.phone) reach.createEl('a', { href: `tel:${contact.phone.replace(/\s+/g, '')}`, text: contact.phone })
    if (!contact.email && !contact.phone) reach.createSpan({ cls: 'pm-contact-missing', text: t('contact.noReach') })
    for (const lot of contact.lots) reach.createSpan({ cls: 'pm-contact-lot', text: lot })

    const stats = row.createDiv('pm-contact-stats')
    const stat = (count: number, label: string, bad = false): void => {
      if (!count) return
      stats.createSpan({ cls: `pm-contact-stat${bad ? ' is-bad' : ''}`, text: label })
    }
    if (work) {
      stat(work.tickets.length, t('contact.tickets', { count: work.tickets.length }))
      stat(work.lateTickets, t('contact.lateTickets', { count: work.lateTickets }), true)
      stat(work.documents.length, t('contact.documents', { count: work.documents.length }))
      stat(work.lateDocuments, t('contact.lateDocuments', { count: work.lateDocuments }), true)
    }
    const actions = row.createDiv('pm-contact-actions')
    if (work?.lateDocuments) {
      const chase = actions.createEl('button', { text: t('chase.button') })
      explain(chase, t('chase.button'), t('tip.chase.button'))
      chase.addEventListener('click', () => {
        const involved = this.projects.filter((one) => work.projects.has(one.filePath))
        openChase(this.plugin, involved, () => this.reload(), contact.name)
      })
    }
    const edit = actions.createEl('button', { cls: 'clickable-icon', attr: { 'aria-label': t('contact.edit') } })
    explain(edit, t('contact.edit'), t('tip.contact.edit'))
    setIcon(edit, 'pencil')
    edit.addEventListener('click', () => openContactModal(this.plugin, { contact, onDone: () => this.reloadSoon() }))

    const items = [...(work?.documents ?? []), ...(work?.tickets ?? [])]
    if (!items.length) return
    const toggle = actions.createEl('button', {
      cls: 'clickable-icon',
      attr: { 'aria-label': t('contact.details') }
    })
    explain(toggle, t('contact.details'), t('tip.contact.details'))
    const isOpen = this.expanded.has(contact.path)
    setIcon(toggle, isOpen ? 'chevron-up' : 'chevron-down')
    toggle.addEventListener('click', () => {
      if (isOpen) this.expanded.delete(contact.path)
      else this.expanded.add(contact.path)
      this.renderBody()
    })
    if (!isOpen) return
    const details = card.createDiv('pm-contact-details')
    if (work?.documents.length) this.renderItems(details, t('contact.owes'), work.documents)
    if (work?.tickets.length) this.renderItems(details, t('contact.holds'), work.tickets)
  }

  private renderItems(parent: HTMLElement, heading: string, items: WorkItem[]): void {
    parent.createDiv({ cls: 'pm-contact-details-title', text: heading })
    const several = new Set(items.map((item) => item.project.path)).size > 1 || !this.project
    for (const item of items) {
      const row = parent.createDiv(`pm-contact-item${item.late ? ' is-late' : ''}`)
      const title = row.createEl('a', { href: '#', text: item.task.title })
      title.addEventListener('click', (event) => {
        event.preventDefault()
        const project = this.projects.find((one) => one.filePath === item.project.path)
        if (project) openTaskModal(this.plugin, project, { task: item.task, onSave: () => this.reload() })
      })
      if (several) row.createSpan({ cls: 'pm-contact-item-project', text: item.project.title })
      row.createSpan({
        cls: 'pm-contact-item-due',
        text: item.task.due ? formatDateShort(item.task.due) : '—'
      })
    }
  }

  private renderUnknown(parent: HTMLElement, unknown: UnknownName[]): void {
    const section = parent.createDiv('pm-contacts-unknown')
    section.createEl('h3', { cls: 'pm-contacts-subtitle', text: t('contact.unknown') })
    section.createDiv({ cls: 'pm-contacts-hint', text: t('contact.unknownDesc') })
    for (const one of unknown) {
      const row = section.createDiv('pm-contacts-unknown-row')
      setIcon(row.createSpan({ cls: 'pm-contact-icon' }), one.issuer ? 'building-2' : 'user')
      row.createSpan({ cls: 'pm-contacts-unknown-name', text: one.name })
      row.createSpan({ cls: 'pm-contacts-unknown-count', text: t('contact.uses', { count: one.count }) })
      const make = row.createEl('button', { text: t('contact.make') })
      explain(make, t('contact.make'), t('tip.contact.make'))
      make.addEventListener('click', () =>
        openContactModal(this.plugin, {
          name: one.name,
          kind: one.issuer ? 'company' : 'person',
          onDone: () => this.reloadSoon()
        })
      )
    }
  }
}
