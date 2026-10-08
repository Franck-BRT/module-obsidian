import { TFile, type App } from 'obsidian'
import { describe, expect, it } from 'vitest'
import { openInWindow, revealInExplorer, shownInObsidian } from './DocumentStore'

const fileOf = (path: string): TFile => {
  const file = new TFile()
  Object.assign(file, { path, name: path.replace(/^.*\//, ''), extension: path.replace(/^.*\./, '') })
  return file
}

function fakeApp(options: { popout?: boolean; explorer?: boolean } = {}) {
  const opened: string[] = []
  const leaf = (where: string) => ({
    openFile: async (file: TFile) => {
      opened.push(`${where}:${file.path}`)
    }
  })
  const revealed: string[] = []
  const explorer = {
    view: { revealInFolder: (file: TFile) => revealed.push(file.path) }
  }
  const app = {
    workspace: {
      openPopoutLeaf: () => {
        if (options.popout === false) throw new Error('no windows')
        return leaf('window')
      },
      getLeaf: () => leaf('tab'),
      getLeavesOfType: (type: string) => (type === 'file-explorer' && options.explorer !== false ? [explorer] : []),
      revealLeaf: async () => {}
    },
    openWithDefaultApp: async (path: string) => {
      opened.push(`system:${path}`)
    }
  }
  return { app: app as unknown as App, opened, revealed }
}

describe('opening a library file', () => {
  it('tells what Obsidian shows itself from what it does not', () => {
    expect(shownInObsidian(fileOf('a/Plan.PDF'))).toBe(true)
    expect(shownInObsidian(fileOf('a/CCTP.docx'))).toBe(false)
  })

  it('opens what Obsidian shows in a window of its own, else in a tab, else with the system', async () => {
    const desktop = fakeApp()
    expect(await openInWindow(desktop.app, fileOf('Lib/Plan.pdf'))).toBe('window')
    expect(await openInWindow(desktop.app, fileOf('Lib/CCTP.docx'))).toBe('system')
    expect(desktop.opened).toEqual(['window:Lib/Plan.pdf', 'system:Lib/CCTP.docx'])

    const mobile = fakeApp({ popout: false })
    expect(await openInWindow(mobile.app, fileOf('Lib/Plan.pdf'))).toBe('tab')
  })

  it('shows a file in the explorer, and says when there is none', async () => {
    const withExplorer = fakeApp()
    expect(await revealInExplorer(withExplorer.app, fileOf('Lib/Fichiers/Plan.pdf'))).toBe(true)
    expect(withExplorer.revealed).toEqual(['Lib/Fichiers/Plan.pdf'])
    expect(await revealInExplorer(fakeApp({ explorer: false }).app, fileOf('Lib/Plan.pdf'))).toBe(false)
  })
})
