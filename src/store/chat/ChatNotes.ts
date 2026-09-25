import { normalizePath, TFile, type App } from 'obsidian'
import {
  appendTurns,
  chatNoteContent,
  chatNoteName,
  isChatNote,
  readChatNote,
  type ChatNote,
  type ChatNoteMeta,
  type ChatNoteWords
} from './chatNote'
import type { ChatTurn } from './chatSession'

/**
 * Conversations in the vault: one note each, in the folder the settings name.
 *
 * Found again by what they say they are — `pm-chat: true` — rather than by where they
 * are, so a conversation the reader moved into a project's folder is still one.
 */
export class ChatNotes {
  constructor(
    private app: App,
    private folder: () => string
  ) {}

  /** A new note holding the conversation so far, under a name nothing else has taken. */
  async create(meta: ChatNoteMeta, turns: ChatTurn[], words: ChatNoteWords): Promise<TFile> {
    const folder = normalizePath(this.folder().trim() || 'Chats')
    if (!this.app.vault.getAbstractFileByPath(folder)) await this.app.vault.createFolder(folder).catch(() => {})
    const base = chatNoteName(meta.title, meta.created)
    let path = normalizePath(`${folder}/${base}.md`)
    for (let n = 2; this.app.vault.getAbstractFileByPath(path); n++) path = normalizePath(`${folder}/${base} ${n}.md`)
    return this.app.vault.create(path, chatNoteContent(meta, turns, words))
  }

  /**
   * More turns at the end of a note. Null when the note is gone — deleted under the
   * panel — so the caller can start a new one rather than lose what was said.
   */
  async append(path: string, turns: ChatTurn[], words: ChatNoteWords): Promise<TFile | null> {
    const file = this.app.vault.getAbstractFileByPath(path)
    if (!(file instanceof TFile)) return null
    await this.app.vault.process(file, (content) => appendTurns(content, turns, words))
    return file
  }

  /** Every conversation in the vault, the latest touched first. */
  list(): TFile[] {
    return this.app.vault
      .getMarkdownFiles()
      .filter((file) => isChatNote(this.app.metadataCache.getFileCache(file)?.frontmatter))
      .sort((a, b) => b.stat.mtime - a.stat.mtime)
  }

  async load(file: TFile): Promise<ChatNote> {
    return readChatNote(await this.app.vault.read(file))
  }
}
