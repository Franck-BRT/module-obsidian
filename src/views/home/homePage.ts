import { setIcon } from 'obsidian'
import { t } from '../../i18n'

/**
 * The home page: where to go from, in one place — the projects, the chat, the people,
 * each library, and the settings —, each a tile saying what it holds. Drawn from counts
 * and actions handed in, so it neither reads the vault nor knows how a view is opened.
 */

export interface HomeCounts {
  projects: number
  contacts: number
  documents: number
  /** The documents whose text is read, for the search. */
  documentsRead: number
  notes: number
  requirements: number
}

export interface HomeActions {
  projects(): void
  chat(): void
  contacts(): void
  documents(): void
  notes(): void
  requirements(): void
  settings(): void
  newProject(): void
  newNote(): void
}

interface Tile {
  cls: string
  icon: string
  title: string
  detail: string
  open: () => void
}

function tile(grid: HTMLElement, one: Tile): void {
  const button = grid.createEl('button', { cls: `pm-home-tile pm-home-tile--${one.cls}` })
  setIcon(button.createSpan('pm-home-tile-icon'), one.icon)
  const text = button.createSpan('pm-home-tile-text')
  text.createSpan({ cls: 'pm-home-tile-title', text: one.title })
  text.createSpan({ cls: 'pm-home-tile-detail', text: one.detail })
  button.addEventListener('click', () => one.open())
}

function section(root: HTMLElement, heading: string, tiles: Tile[]): void {
  const block = root.createDiv('pm-home-section')
  block.createEl('h2', { cls: 'pm-home-section-title', text: heading })
  const grid = block.createDiv('pm-home-grid')
  for (const one of tiles) tile(grid, one)
}

export function renderHome(root: HTMLElement, counts: HomeCounts, go: HomeActions): void {
  root.empty()
  const page = root.createDiv('pm-home')
  const head = page.createDiv('pm-home-head')
  setIcon(head.createSpan('pm-home-logo'), 'chart-gantt')
  const title = head.createDiv('pm-home-title')
  title.createEl('h1', { text: t('home.heading') })
  title.createDiv({ cls: 'pm-home-intro', text: t('home.intro') })
  const quick = head.createDiv('pm-home-quick')
  const action = (icon: string, label: string, run: () => void, cta = false): void => {
    const button = quick.createEl('button', { cls: cta ? 'mod-cta' : '' })
    setIcon(button.createSpan('pm-home-quick-icon'), icon)
    button.createSpan({ text: label })
    button.addEventListener('click', run)
  }
  action('plus', t('home.newProject'), () => go.newProject(), true)
  action('file-plus', t('home.newNote'), () => go.newNote())

  section(page, t('home.section.work'), [
    {
      cls: 'projects',
      icon: 'chart-gantt',
      title: t('home.projects'),
      detail: counts.projects ? t('home.projects.detail', { count: counts.projects }) : t('home.projects.none'),
      open: () => go.projects()
    },
    {
      cls: 'chat',
      icon: 'messages-square',
      title: t('home.chat'),
      detail: t('home.chat.detail'),
      open: () => go.chat()
    },
    {
      cls: 'contacts',
      icon: 'contact',
      title: t('home.contacts'),
      detail: t('home.contacts.detail', { count: counts.contacts }),
      open: () => go.contacts()
    }
  ])
  section(page, t('home.section.libraries'), [
    {
      cls: 'documents',
      icon: 'library-big',
      title: t('home.documents'),
      detail: t('home.documents.detail', { count: counts.documents, read: counts.documentsRead }),
      open: () => go.documents()
    },
    {
      cls: 'notes',
      icon: 'notebook-pen',
      title: t('home.notes'),
      detail: t('home.notes.detail', { count: counts.notes }),
      open: () => go.notes()
    },
    {
      cls: 'requirements',
      icon: 'list-checks',
      title: t('home.requirements'),
      detail: t('home.requirements.detail', { count: counts.requirements }),
      open: () => go.requirements()
    }
  ])
  section(page, t('home.section.setup'), [
    {
      cls: 'settings',
      icon: 'settings',
      title: t('home.settings'),
      detail: t('home.settings.detail'),
      open: () => go.settings()
    }
  ])
}
