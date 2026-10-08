import { Menu, setIcon, SuggestModal, type App } from 'obsidian'
import { AT_ROOT } from '../store/folderFilter'
import { parentOf } from '../store/libraryFolders'
import { t } from '../i18n'
import { explain } from '../ui/explain'

/** A folder of a library chosen: one it has — '' for its root —, or a new one named. */
export type FolderChoice = { kind: 'folder'; path: string } | { kind: 'new'; name: string }

/**
 * A folder filter's choices: every folder, the root alone, then the library's folders, each
 * under the one it is in.
 */
export function folderOptions(folders: string[], rootLabel: string): [string, string][] {
  return [
    ['', t('folders.allFolders')],
    [AT_ROOT, rootLabel],
    ...folders.map((folder): [string, string] => {
      const depth = folder.split('/').length - 1
      return [folder, `${'\u2003'.repeat(depth)}${folder.slice(folder.lastIndexOf('/') + 1)}`]
    })
  ]
}

/** The folder a filter shows, where something new goes: '' at the root, or when all are shown. */
export function filteredFolder(folder: string | undefined): string {
  return !folder || folder === AT_ROOT ? '' : folder
}

/** A folder of a library to move things into: its root, one of its folders, or a new one named. */
export class FolderPicker extends SuggestModal<FolderChoice> {
  constructor(
    app: App,
    private folders: string[],
    private rootLabel: string,
    private onChoose: (choice: FolderChoice) => void,
    placeholder = t('folders.moveToPlaceholder')
  ) {
    super(app)
    this.setPlaceholder(placeholder)
  }

  getSuggestions(query: string): FolderChoice[] {
    const q = query.trim().toLowerCase()
    const found = ['', ...this.folders]
      .filter((path) => (path || this.rootLabel).toLowerCase().includes(q))
      .map((path): FolderChoice => ({ kind: 'folder', path }))
    // A name no folder has: offered to be made.
    if (q && !this.folders.some((path) => path.toLowerCase() === q)) found.push({ kind: 'new', name: query.trim() })
    return found
  }

  renderSuggestion(choice: FolderChoice, el: HTMLElement): void {
    const line = el.createDiv({ cls: 'pm-chat-pick-line' })
    setIcon(line.createSpan({ cls: 'pm-chat-pick-icon' }), choice.kind === 'new' ? 'folder-plus' : 'folder')
    line.createSpan({
      text: choice.kind === 'new' ? t('folders.newFolderNamed', { name: choice.name }) : choice.path || this.rootLabel
    })
  }

  onChooseSuggestion(choice: FolderChoice): void {
    this.onChoose(choice)
  }
}

/** What a row of a library carries when it is dragged: the paths of what is moved. */
export const DRAG_TYPE = 'application/x-pm-library'

/** Makes a row draggable onto a folder: itself, or everything ticked when it is ticked. */
export function dragRows(row: HTMLElement, paths: () => string[]): void {
  row.draggable = true
  row.addEventListener('dragstart', (event) => {
    if (!event.dataTransfer) return
    event.dataTransfer.setData(DRAG_TYPE, JSON.stringify(paths()))
    event.dataTransfer.effectAllowed = 'move'
    row.addClass('is-dragged')
  })
  row.addEventListener('dragend', () => row.removeClass('is-dragged'))
}

/** What was dragged from a row, or nothing when what is dragged is not rows. */
function draggedPaths(event: DragEvent): string[] {
  try {
    const raw: unknown = JSON.parse(event.dataTransfer?.getData(DRAG_TYPE) || '[]')
    return Array.isArray(raw) ? raw.filter((path): path is string => typeof path === 'string') : []
  } catch {
    return []
  }
}

/** Makes an element a place rows can be dropped on. */
function dropTarget(el: HTMLElement, onDrop: (paths: string[]) => void): void {
  const accepts = (event: DragEvent): boolean => !!event.dataTransfer?.types.includes(DRAG_TYPE)
  el.addEventListener('dragover', (event) => {
    if (!accepts(event)) return
    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
    el.addClass('is-drop-target')
  })
  el.addEventListener('dragleave', () => el.removeClass('is-drop-target'))
  el.addEventListener('drop', (event) => {
    el.removeClass('is-drop-target')
    if (!accepts(event)) return
    event.preventDefault()
    event.stopPropagation()
    const paths = draggedPaths(event)
    if (paths.length) onDrop(paths)
  })
}

export interface FolderStrip {
  /** Every folder of the library, by its path under the library's. */
  folders: string[]
  /** The folder filter: '' for every folder, `AT_ROOT`, or a folder. */
  current: string
  /** Shows a folder — `AT_ROOT` for the library's root. */
  open: (folder: string) => void
  /** Rows dropped on a folder — '' for the root. */
  drop: (paths: string[], folder: string) => void
  rename: (folder: string) => void
  remove: (folder: string) => void
}

/**
 * Where the list is in the library's folders, and the way about them: the folders above
 * the one shown, the one shown — to rename or take out —, and the folders it holds. Each
 * one opens on a click, and takes the rows dropped on it.
 */
export function renderFolderStrip(parent: HTMLElement, strip: FolderStrip): void {
  const current = filteredFolder(strip.current)
  if (!strip.folders.length && !current) return
  const el = parent.createDiv('pm-folder-strip')
  const crumb = (label: string, folder: string, cls = ''): HTMLElement => {
    const link = el.createEl('a', { cls: `pm-folder-crumb ${cls}`.trim(), text: label, href: '#' })
    link.addEventListener('click', (event) => {
      event.preventDefault()
      strip.open(folder || AT_ROOT)
    })
    dropTarget(link, (paths) => strip.drop(paths, folder))
    explain(link, label, t('tip.folder.crumb'))
    return link
  }
  setIcon(el.createSpan({ cls: 'pm-folder-strip-icon' }), 'folder-tree')
  crumb(t('folders.root'), '', strip.current === AT_ROOT ? 'is-current' : '')
  if (current) {
    const parts = current.split('/')
    parts.forEach((name, at) => {
      el.createSpan({ cls: 'pm-folder-sep', text: '›' })
      crumb(name, parts.slice(0, at + 1).join('/'), at === parts.length - 1 ? 'is-current' : '')
    })
    const rename = el.createEl('button', {
      cls: 'clickable-icon pm-folder-action',
      attr: { 'aria-label': t('folders.rename', { folder: current }) }
    })
    setIcon(rename, 'pencil')
    explain(rename, t('folders.rename', { folder: current }), t('tip.folder.rename'))
    rename.addEventListener('click', () => strip.rename(current))
    const remove = el.createEl('button', {
      cls: 'clickable-icon pm-folder-action',
      attr: { 'aria-label': t('folders.delete', { folder: current }) }
    })
    setIcon(remove, 'folder-x')
    explain(remove, t('folders.delete', { folder: current }), t('tip.folder.remove'))
    remove.addEventListener('click', () => strip.remove(current))
  }
  // The folders the one shown holds — at the root, the library's first ones.
  const inside = strip.folders.filter((folder) => parentOf(folder) === current)
  if (inside.length) el.createSpan({ cls: 'pm-folder-sep is-gap' })
  for (const folder of inside) {
    const chip = el.createEl('a', { cls: 'pm-folder-chip', href: '#' })
    setIcon(chip.createSpan({ cls: 'pm-folder-chip-icon' }), 'folder')
    chip.createSpan({ text: folder.slice(folder.lastIndexOf('/') + 1) })
    chip.addEventListener('click', (event) => {
      event.preventDefault()
      strip.open(folder)
    })
    dropTarget(chip, (paths) => strip.drop(paths, folder))
    explain(chip, folder.slice(folder.lastIndexOf('/') + 1), t('tip.folder.chip'))
  }
}

export interface FolderTree extends FolderStrip {
  /** How many rows each folder holds itself, by its path; '' for the root's own. */
  counts: Map<string, number>
  /** How many rows in all: what « every folder » shows. */
  total: number
  /** The folders unfolded: their own folders shown under them. */
  expanded: Set<string>
  toggle: (folder: string) => void
  /** A folder made under this one — '' for the root. */
  create: (under: string) => void
  /** The folder marked with a star: the reference documents'. */
  reference?: string
  rootLabel: string
}

/**
 * The library's folders as a tree beside the list, as a file explorer has them: every
 * folder at once, the root, then each folder under the one it is in, unfolded or not, with
 * how many rows it holds — itself and below. One opens on a click and takes the rows
 * dropped on it; its menu makes a folder in it, renames it or takes it out.
 */
export function renderFolderTree(parent: HTMLElement, tree: FolderTree): void {
  parent.empty()
  const current = tree.current
  const below = (folder: string): number => {
    let sum = tree.counts.get(folder) ?? 0
    for (const [path, count] of tree.counts) if (path && folder && path.startsWith(`${folder}/`)) sum += count
    return sum
  }
  const head = parent.createDiv('pm-tree-head')
  head.createSpan({ cls: 'pm-tree-head-title', text: t('folders.tree') })
  const add = head.createEl('button', { cls: 'clickable-icon', attr: { 'aria-label': t('folders.newFolder') } })
  setIcon(add, 'folder-plus')
  explain(add, t('folders.newFolder'), t('tip.folder.treeNew'))
  add.addEventListener('click', () => tree.create(filteredFolder(current)))

  const list = parent.createDiv({ cls: 'pm-tree', attr: { role: 'tree' } })
  const item = (options: {
    label: string
    folder: string
    value: string
    depth: number
    icon: string
    count: number
    children?: boolean
    menu?: boolean
  }): void => {
    const row = list.createDiv({
      cls: `pm-tree-item${current === options.value ? ' is-current' : ''}`,
      attr: { role: 'treeitem', tabindex: '0', style: `--pm-tree-depth: ${options.depth}` }
    })
    const twisty = row.createSpan('pm-tree-twisty')
    if (options.children) {
      const open = tree.expanded.has(options.folder)
      setIcon(twisty, open ? 'chevron-down' : 'chevron-right')
      row.setAttr('aria-expanded', String(open))
      twisty.addEventListener('click', (event) => {
        event.stopPropagation()
        tree.toggle(options.folder)
      })
    }
    setIcon(row.createSpan('pm-tree-icon'), options.icon)
    row.createSpan({ cls: 'pm-tree-label', text: options.label })
    if (options.count) row.createSpan({ cls: 'pm-tree-count', text: String(options.count) })
    row.addEventListener('click', () => tree.open(options.value))
    row.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') tree.open(options.value)
      if (options.children && (event.key === 'ArrowRight' || event.key === 'ArrowLeft')) {
        const open = tree.expanded.has(options.folder)
        if (open === (event.key === 'ArrowLeft')) tree.toggle(options.folder)
      }
    })
    if (options.value !== '') dropTarget(row, (paths) => tree.drop(paths, options.folder))
    row.addEventListener('contextmenu', (event) => {
      event.preventDefault()
      const menu = new Menu()
      menu.addItem((entry) =>
        entry
          .setTitle(options.folder ? t('folders.newFolderIn', { folder: options.label }) : t('folders.newFolder'))
          .setIcon('folder-plus')
          .onClick(() => tree.create(options.folder))
      )
      if (options.menu) {
        menu.addItem((entry) =>
          entry
            .setTitle(t('folders.rename', { folder: options.label }))
            .setIcon('pencil')
            .onClick(() => tree.rename(options.folder))
        )
        menu.addItem((entry) =>
          entry
            .setTitle(t('folders.delete', { folder: options.label }))
            .setIcon('folder-x')
            .setWarning(true)
            .onClick(() => tree.remove(options.folder))
        )
      }
      menu.showAtMouseEvent(event)
    })
  }

  item({ label: t('folders.allFolders'), folder: '', value: '', depth: 0, icon: 'library', count: tree.total })
  const tops = tree.folders.filter((folder) => !folder.includes('/'))
  item({
    label: tree.rootLabel,
    folder: '',
    value: AT_ROOT,
    depth: 0,
    icon: 'folder-root',
    count: tree.counts.get('') ?? 0
  })
  const walk = (folders: string[], depth: number): void => {
    for (const folder of folders) {
      const children = tree.folders.filter((other) => parentOf(other) === folder)
      const name = folder.slice(folder.lastIndexOf('/') + 1)
      const isReference = !!tree.reference && folder === tree.reference
      item({
        label: name,
        folder,
        value: folder,
        depth,
        icon: isReference ? 'star' : tree.expanded.has(folder) && children.length ? 'folder-open' : 'folder',
        count: below(folder),
        children: children.length > 0,
        menu: true
      })
      if (children.length && tree.expanded.has(folder)) walk(children, depth + 1)
    }
  }
  walk(tops, 1)
}
