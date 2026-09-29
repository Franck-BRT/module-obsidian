import { setIcon, SuggestModal, type App } from 'obsidian'
import { AT_ROOT } from '../store/folderFilter'
import { t } from '../i18n'

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
    private onChoose: (choice: FolderChoice) => void
  ) {
    super(app)
    this.setPlaceholder(t('folders.moveToPlaceholder'))
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
