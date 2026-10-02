import { describe, expect, it } from 'vitest'

/**
 * Obsidian opens a view by calling its `open(containerEl)`, which calls `onOpen`, and
 * closes, loads and unloads it the same way. None of them is in Obsidian's published
 * types, so nothing stops a view from declaring a method of the same name for its own
 * use — and the view then never opens: the notes library was a blank page for that. A
 * field of the same name hides them just as well: the contacts view was a blank page
 * for a set of expanded cards called `open`.
 */

declare global {
  interface ImportMeta {
    glob: (
      pattern: string | string[],
      options: { query: string; import: string; eager: true }
    ) => Record<string, string>
  }
}

const SOURCES = import.meta.glob(['../**/*.ts', '!../**/*.test.ts'], { query: '?raw', import: 'default', eager: true })
const RESERVED = ['open', 'close', 'load', 'unload']
const OBSIDIAN_CLASS =
  /^(?:export )?(?:default )?class \w+ extends (ItemView|View|FileView|TextFileView|Modal|SuggestModal|FuzzySuggestModal)\b/

describe('the plugin’s views and dialogs', () => {
  it('are all looked at', () => {
    expect(Object.keys(SOURCES).some((path) => path.endsWith('notes/NotesView.ts'))).toBe(true)
  })

  it('never take — as a method or a field — the name of one Obsidian opens, closes, loads or unloads them by', () => {
    const clashes: string[] = []
    for (const [path, text] of Object.entries(SOURCES)) {
      for (const block of text.split(
        /\n(?=(?:export )?(?:default )?(?:abstract )?(?:class|interface|type|function|async function|const|let|enum) )/
      )) {
        if (!OBSIDIAN_CLASS.test(block)) continue
        for (const name of RESERVED) {
          const member = new RegExp(
            `\\n  (?:(?:private|protected|public|readonly|override|static|declare) )*(?:async )?${name}\\s*[(=:!?;]`
          )
          if (member.test(block)) clashes.push(`${path}: ${name}`)
        }
      }
    }
    expect(clashes).toEqual([])
  })
})
