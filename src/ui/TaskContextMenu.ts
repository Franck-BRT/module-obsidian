import { Menu, Notice } from 'obsidian'
import type PMPlugin from '../main'
import type { Task, Project } from '../types'
import { safeAsync } from '../utils'
import { openTaskModal, confirmDialog, confirmDuplicateSubtasks, openProjectPicker } from './ModalFactory'
import { t } from '../i18n'

export interface TaskMenuContext {
  plugin: PMPlugin
  project: Project
  onRefresh: () => Promise<void>
}

/** Edit, Add subtask, Archive/Unarchive, Delete. */
export function buildTaskContextMenu(menu: Menu, task: Task, ctx: TaskMenuContext): Menu {
  menu.addItem((item) =>
    item
      .setTitle(t('menu.editTask'))
      .setIcon('pencil')
      .onClick(() => {
        openTaskModal(ctx.plugin, ctx.project, {
          task,
          onSave: async () => {
            await ctx.onRefresh()
          }
        })
      })
  )
  menu.addItem((item) =>
    item
      .setTitle(t('task.addSubtask'))
      .setIcon('plus')
      .onClick(() => {
        openTaskModal(ctx.plugin, ctx.project, {
          parentId: task.id,
          onSave: async () => {
            await ctx.onRefresh()
          }
        })
      })
  )
  menu.addItem((item) =>
    item
      .setTitle(t('menu.duplicateTask'))
      .setIcon('copy')
      .onClick(
        safeAsync(async () => {
          let includeSubtasks = false
          if (task.subtasks.length > 0) {
            const choice = await confirmDuplicateSubtasks(ctx.plugin.app, task.title)
            if (choice === null) return
            includeSubtasks = choice === 'with-subtasks'
          }
          await ctx.plugin.store.duplicateTask(ctx.project, task.id, includeSubtasks)
          await ctx.onRefresh()
        })
      )
  )
  menu.addItem((item) =>
    item
      .setTitle(t('menu.moveToProject'))
      .setIcon('folder-input')
      .onClick(() => {
        const targets = ctx.plugin.index.projectRefs().filter((ref) => ref.path !== ctx.project.filePath)
        if (!targets.length) {
          new Notice(t('menu.noOtherProject'))
          return
        }
        openProjectPicker(
          ctx.plugin,
          targets,
          safeAsync(async (ref) => {
            const target = await ctx.plugin.store.loadProjectByPath(ref.path)
            if (!target) return
            await ctx.plugin.store.moveTaskToProject(ctx.project, target, task.id)
            new Notice(t('menu.movedTask', { task: task.title, project: target.title }))
            await ctx.onRefresh()
          })
        )
      })
  )
  menu.addSeparator()
  if (task.archived) {
    menu.addItem((item) =>
      item
        .setTitle(t('common.unarchive'))
        .setIcon('archive-restore')
        .onClick(
          safeAsync(async () => {
            await ctx.plugin.store.unarchiveTask(ctx.project, task.id)
            new Notice(t('editor.taskUnarchived'))
            await ctx.onRefresh()
          })
        )
    )
  } else {
    menu.addItem((item) =>
      item
        .setTitle(t('common.archive'))
        .setIcon('archive')
        .onClick(
          safeAsync(async () => {
            await ctx.plugin.store.archiveTask(ctx.project, task.id)
            new Notice(t('editor.taskArchived'))
            await ctx.onRefresh()
          })
        )
    )
  }
  menu.addItem((item) =>
    item
      .setTitle(t('menu.deleteTask'))
      .setIcon('trash')
      .onClick(
        safeAsync(async () => {
          if (await confirmDialog(ctx.plugin.app, `Delete "${task.title}"?`)) {
            await ctx.plugin.store.deleteTask(ctx.project, task.id)
            await ctx.onRefresh()
          }
        })
      )
  )
  return menu
}
