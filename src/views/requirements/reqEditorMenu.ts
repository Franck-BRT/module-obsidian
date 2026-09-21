import type PMPlugin from '../../main'
import { t } from '../../i18n'

/**
 * "Insérer une exigence", where an author right-clicks while writing.
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
    plugin.app.workspace.on('editor-menu', (menu, editor) => {
      menu.addItem((item) =>
        item
          .setTitle(t('req.insert'))
          .setIcon('list-checks')
          .setSection('insert')
          .onClick(() => {
            void plugin.insertRequirementAt(editor)
          })
      )
    })
  )
}
