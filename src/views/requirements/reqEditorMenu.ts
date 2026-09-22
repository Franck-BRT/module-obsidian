import { TFile } from 'obsidian'
import type PMPlugin from '../../main'
import { reqBlockRanges } from '../../store/requirements/reqFence'
import { safeAsync } from '../../utils'
import { exportNoteDocx } from './exportDocx'
import { t } from '../../i18n'

/**
 * "Insérer une exigence" and "Exporter en Word", where an author right-clicks while
 * writing.
 *
 * The command palette is where a feature lives; a context menu is where it is found. A
 * specification is written by someone whose hands are in the prose, and asking them to
 * remember a command name is asking them to stop writing.
 *
 * The section is Obsidian's own `insert` group — the one its Insert submenu is built
 * from — so the entry sits with the footnotes, tables and code blocks rather than
 * arriving as a stray line at the bottom of the menu. A section Obsidian does not know
 * costs nothing: it appends a group of its own and the entry is still there.
 */
export function registerReqEditorMenu(plugin: PMPlugin): void {
  plugin.registerEvent(
    plugin.app.workspace.on('editor-menu', (menu, editor, view) => {
      menu.addItem((item) =>
        item
          .setTitle(t('req.insert'))
          .setIcon('list-checks')
          .setSection('insert')
          .onClick(() => {
            void plugin.insertRequirementAt(editor)
          })
      )
      // Offered only where it would do something: a note quoting no requirement is a
      // note Word has nothing this plugin can add to.
      const file = view.file
      if (!(file instanceof TFile) || !reqBlockRanges(editor.getValue().split('\n')).length) return
      for (const format of ['docx', 'pdf'] as const) {
        menu.addItem((item) =>
          item
            .setTitle(format === 'pdf' ? t('req.exportNotePdf') : t('req.exportNoteWord'))
            .setIcon(format === 'pdf' ? 'file-text' : 'file-type')
            .onClick(safeAsync(() => exportNoteDocx(plugin, file, format)))
        )
      }
    })
  )
}
