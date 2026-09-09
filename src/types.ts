import { today } from './dates'
import type { TaskIndex } from './store/TaskIndex'
import type { WorkCalendar } from './store/WorkCalendar'
import type { LanguageSetting } from './i18n'
import { t } from './i18n'

export type TaskStatus = string
export type TaskPriority = string
export type GanttGranularity = 'day' | 'week' | 'month' | 'quarter' | 'year'
export type GanttWeekLabel = 'weekNumber' | 'dateRange' | 'both'
export type ViewMode = 'table' | 'gantt' | 'kanban'
export type LineBorders = 'none' | 'horizontal' | 'vertical' | 'both'
export type DueDateFilter = 'any' | 'overdue' | 'this-week' | 'this-month' | 'no-date'
export type TaskType = 'task' | 'milestone' | 'subtask'

export interface Recurrence {
  interval: 'daily' | 'weekly' | 'monthly' | 'yearly'
  every: number // e.g. every 2 weeks
  endDate?: string // YYYY-MM-DD
}

/**
 * How a dependency ties two tasks together. FS is the default and the only one the
 * plugin wrote before: the successor starts after the predecessor finishes.
 */
export const DEPENDENCY_TYPES = ['FS', 'SS', 'FF', 'SF'] as const
export type DependencyType = (typeof DEPENDENCY_TYPES)[number]

export function dependencyTypeLabel(type: DependencyType): string {
  return t(`dependency.${type}`)
}

/** Extra scheduling terms for one predecessor. Lag is in working days and may be negative. */
export interface DependencyOption {
  type: DependencyType
  lag: number
}

export const DEFAULT_DEPENDENCY_OPTION: DependencyOption = { type: 'FS', lag: 0 }

export interface TimeLog {
  date: string // YYYY-MM-DD
  hours: number
  note: string
}

export const CUSTOM_FIELD_TYPES = [
  'text',
  'number',
  'date',
  'select',
  'multiselect',
  'person',
  'checkbox',
  'url'
] as const

export interface CustomFieldDef {
  id: string
  name: string
  type: (typeof CUSTOM_FIELD_TYPES)[number]
  options?: string[] // for select / multiselect
  icon?: string // emoji or lucide icon name
}

export interface Task {
  id: string
  title: string
  description: string
  type: TaskType // 'task' or 'milestone' (zero-duration)
  status: TaskStatus
  priority: TaskPriority
  start: string // YYYY-MM-DD, empty string = unset
  due: string // YYYY-MM-DD, empty string = unset
  progress: number // 0–100
  completed: string // YYYY-MM-DD, empty string = not completed; stamped when status becomes complete
  assignees: string[]
  tags: string[]
  subtasks: Task[]
  dependencies: string[] // task IDs
  /**
   * Keyed by predecessor task id. A dependency with no entry is finish-to-start with
   * no lag, so the common case adds nothing to a task's note.
   */
  dependencyOptions?: Record<string, DependencyOption>
  recurrence?: Recurrence
  timeEstimate?: number // hours
  timeLogs?: TimeLog[]
  customFields: Record<string, unknown>
  /** UI state, persisted per project in plugin settings (data.json), not in frontmatter. */
  collapsed: boolean
  createdAt: string
  updatedAt: string
  filePath?: string // vault path to this task's .md file
  archived?: boolean // runtime only — derived from file location in Archive/ subfolder
}

export interface Project {
  id: string
  title: string
  description: string
  color: string // hex
  icon: string // emoji
  tasks: Task[]
  customFields: CustomFieldDef[]
  teamMembers: string[]
  createdAt: string
  updatedAt: string
  filePath: string // resolved vault path
  savedViews: SavedView[]
  /** The project this one sits under, resolved from its `parent` link. */
  parentPath?: string
  /** Per-project overrides for the global settings. Absent fields inherit. */
  config?: ProjectConfig
  /** Not serialized. Rebuilt on load, maintained by the store's mutators. */
  taskIndex: TaskIndex
}

/** Tasks are excluded: they change through the task mutators, never a whole-project write. */
export type ProjectPatch = Partial<
  Pick<
    Project,
    'title' | 'description' | 'color' | 'icon' | 'customFields' | 'teamMembers' | 'savedViews' | 'config' | 'parentPath'
  >
>

export interface FilterState {
  text: string
  statuses: TaskStatus[]
  priorities: TaskPriority[]
  assignees: string[]
  tags: string[]
  dueDateFilter: DueDateFilter
  showArchived: boolean
}

export interface SavedView {
  id: string
  name: string
  filter: FilterState
  sortKey: string
  sortDir: 'asc' | 'desc'
  viewMode?: ViewMode
}

/**
 * A named set of tasks drawn from across projects: a reporting pack, everything at one
 * status, a theme that cuts through the portfolio. The tasks stay in the projects that
 * own them — a collection holds references, never copies, and editing one from here
 * writes back to its own note.
 *
 * Membership is `rule` (when set) plus `include`, minus `exclude`. A collection with no
 * rule is a purely hand-picked list; one with a rule and no manual entries is a live
 * query; the two combine so a rule can be corrected without being abandoned.
 */
export interface Collection {
  id: string
  title: string
  description: string
  color: string
  icon: string
  /** Project paths the rule searches. Empty means every project in the vault. */
  sources: string[]
  /** Absent means membership is the manual list alone. */
  rule?: FilterState
  /** Task ids pulled in by hand, whatever the rule says. */
  include: string[]
  /** Task ids kept out by hand, even when the rule matches them. */
  exclude: string[]
  createdAt: string
  updatedAt: string
  filePath: string
}

export interface PerProjectFilter {
  filter: FilterState
  activeSavedViewId: string | null
}

export interface StatusConfig {
  id: string
  label: string
  color: string
  icon: string
  complete: boolean
}

/** Overrides a project may set in its own file. An absent field falls back to the global settings. */
export interface ProjectConfig {
  statuses?: StatusConfig[]
  priorities?: PriorityConfig[]
  priorityIcons?: PriorityIconSet
  /** Inherited field ids this project leaves out. Its own fields are never listed. */
  hiddenCustomFields?: string[]
  defaultView?: ViewMode
  autoSchedule?: boolean
  pullForwardOnEarlyFinish?: boolean
  /** The working week and holidays stay global; a project only opts in or out. */
  respectWorkingDays?: boolean
  autoArchiveDays?: number
  showSubtreeConnections?: boolean
  lineBorders?: LineBorders
  kanbanShowSubtasks?: boolean
  kanbanShowDescriptionPreview?: boolean
}

/**
 * A project's config with every fallback applied. Views and modals read this rather
 * than the global settings, so another task source can supply its own catalogs.
 */
export interface ResolvedProjectConfig {
  statuses: StatusConfig[]
  priorities: PriorityConfig[]
  priorityIcons: PriorityIconSet
  customFields: CustomFieldDef[]
  defaultView: ViewMode
  autoSchedule: boolean
  pullForwardOnEarlyFinish: boolean
  /** Working days this project schedules against, already resolved from the settings. */
  workCalendar: WorkCalendar
  autoArchiveDays: number
  showSubtreeConnections: boolean
  lineBorders: LineBorders
  kanbanShowSubtasks: boolean
  kanbanShowDescriptionPreview: boolean
}

export interface PriorityConfig {
  id: TaskPriority
  label: string
  color: string
  icon: string
}

export type PriorityIconSet = 'chevrons' | 'signal' | 'arrows' | 'alerts' | 'none'

/** One icon per rank, highest priority first. Ranks past the fifth carry no icon. */
export const PRIORITY_ICON_SETS: Record<PriorityIconSet, string[]> = {
  chevrons: ['chevrons-up', 'chevron-up', 'equal', 'chevron-down', 'chevrons-down'],
  signal: ['signal', 'signal-high', 'signal-medium', 'signal-low', 'signal-zero'],
  arrows: ['arrow-up', 'arrow-up-right', 'arrow-right', 'arrow-down-right', 'arrow-down'],
  alerts: ['octagon-alert', 'triangle-alert', 'circle-alert', 'info', 'circle-small'],
  none: []
}

export function priorityIconSetLabels(): Record<PriorityIconSet, string> {
  return {
    chevrons: t('priorityIcons.chevrons'),
    signal: t('priorityIcons.signal'),
    arrows: t('priorityIcons.arrows'),
    alerts: t('priorityIcons.alerts'),
    none: t('priorityIcons.none')
  }
}

export interface PMSettings {
  /** Where new projects are created. Projects are discovered vault-wide, wherever they live. */
  projectsFolder: string
  peopleFolder: string
  /** Folders discovery skips, for templates and archives holding pm-project notes. */
  excludedFolders: string[]
  defaultView: ViewMode
  ganttGranularity: GanttGranularity
  ganttWeekLabel: GanttWeekLabel
  statuses: StatusConfig[]
  priorities: PriorityConfig[]
  /** Icons for priorities that don't carry their own. */
  priorityIcons: PriorityIconSet
  /** Task properties every project starts with. A project adds to these, or overrides one by id. */
  customFields: CustomFieldDef[]
  globalTeamMembers: string[]
  notificationsEnabled: boolean
  notificationLeadDays: number
  /** Days after completion before a task moves to its project's archive. 0 turns it off. */
  autoArchiveDays: number
  /** The day the archive sweep last ran, so it runs at most once a day. */
  lastAutoArchiveDate: string
  autoSchedule: boolean
  pullForwardOnEarlyFinish: boolean
  /** Keep scheduled dates off weekends and holidays. Off leaves plans on plain calendar days. */
  respectWorkingDays: boolean
  /** ISO weekday numbers work can land on: 1 is Monday, 7 is Sunday. */
  workingWeekdays: number[]
  /** Public holidays and shutdowns as YYYY-MM-DD, skipped like a weekend. */
  holidays: string[]
  showSubtreeConnections: boolean
  lineBorders: LineBorders
  kanbanShowSubtasks: boolean
  kanbanShowDescriptionPreview: boolean
  showTagColors: boolean
  saveTaskOnClose: boolean
  taskEditorSurface: 'modal' | 'tab'
  /** 'auto' follows Obsidian's own UI language. */
  language: LanguageSetting
  /** Key shortcut to create or save tasks and projects. */
  editorSaveModifier: 'Shift' | 'Mod'
  /** Where a project link lands: its overview page or its tasks in the default view. */
  projectSurface: 'overview' | 'tasks'
  /** Keyed by scope key, e.g. `project:Projects/Roadmap.md`. */
  projectFilters: Record<string, PerProjectFilter>
  /** Saved views for a scope covering several projects, which has no file to keep them in. */
  scopeViews: Record<string, SavedView[]>
  /** Collapsed task ids per project path. Lives here so a toggle doesn't rewrite task files. */
  collapsedTasks: Record<string, string[]>
  /** Paths of projects whose sub-projects are collapsed in the project list. */
  collapsedProjects: string[]
}

export const DEFAULT_STATUSES: StatusConfig[] = [
  { id: 'todo', label: 'To Do', color: '#8a94a0', icon: '', complete: false },
  { id: 'in-progress', label: 'In Progress', color: '#8b72be', icon: '', complete: false },
  { id: 'blocked', label: 'Blocked', color: '#c47070', icon: '', complete: false },
  { id: 'review', label: 'In Review', color: '#b8a06b', icon: '', complete: false },
  { id: 'done', label: 'Done', color: '#79b58d', icon: '', complete: true },
  { id: 'cancelled', label: 'Cancelled', color: '#767491', icon: '', complete: true }
]

export const DEFAULT_PRIORITIES: PriorityConfig[] = [
  { id: 'critical', label: 'Critical', color: '#c47070', icon: '' },
  { id: 'high', label: 'High', color: '#b8a06b', icon: '' },
  { id: 'medium', label: 'Medium', color: '#8a94a0', icon: '' },
  { id: 'low', label: 'Low', color: '#79b58d', icon: '' }
]

/**
 * The palettes a fresh install starts with, in the active language. They are seeded
 * into the user's settings once and editable from there on, so switching language
 * later leaves labels the user may have renamed alone.
 */
export function seedStatuses(): StatusConfig[] {
  const labels: Record<string, string> = {
    todo: t('default.status.todo'),
    'in-progress': t('default.status.inProgress'),
    blocked: t('default.status.blocked'),
    review: t('default.status.review'),
    done: t('default.status.done'),
    cancelled: t('default.status.cancelled')
  }
  return DEFAULT_STATUSES.map((s) => ({ ...s, label: labels[s.id] ?? s.label }))
}

export function seedPriorities(): PriorityConfig[] {
  const labels: Record<string, string> = {
    critical: t('default.priority.critical'),
    high: t('default.priority.high'),
    medium: t('default.priority.medium'),
    low: t('default.priority.low')
  }
  return DEFAULT_PRIORITIES.map((p) => ({ ...p, label: labels[p.id] ?? p.label }))
}

export const DEFAULT_SETTINGS: PMSettings = {
  projectsFolder: 'Projects',
  peopleFolder: 'People',
  excludedFolders: [],
  defaultView: 'table',
  ganttGranularity: 'week',
  ganttWeekLabel: 'weekNumber',
  statuses: DEFAULT_STATUSES,
  priorities: DEFAULT_PRIORITIES,
  priorityIcons: 'chevrons',
  customFields: [],
  globalTeamMembers: [],
  showSubtreeConnections: true,
  lineBorders: 'none',
  kanbanShowSubtasks: false,
  kanbanShowDescriptionPreview: false,
  showTagColors: true,
  notificationsEnabled: true,
  notificationLeadDays: 2,
  autoArchiveDays: 0,
  lastAutoArchiveDate: '',
  autoSchedule: true,
  pullForwardOnEarlyFinish: false,
  // Off by default: turning it on is one toggle, but having it on would silently
  // move the dates of every existing plan on the first reschedule.
  respectWorkingDays: false,
  workingWeekdays: [1, 2, 3, 4, 5],
  holidays: [],
  saveTaskOnClose: true,
  taskEditorSurface: 'modal',
  language: 'auto',
  editorSaveModifier: 'Shift',
  projectSurface: 'overview',
  projectFilters: {},
  scopeViews: {},
  collapsedTasks: {},
  collapsedProjects: []
}

export function makeId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
}

export function makeCollection(title: string, filePath: string): Collection {
  const now = new Date().toISOString()
  return {
    id: makeId(),
    title,
    description: '',
    color: '#6b8fbe',
    icon: '\u{1F5C2}\uFE0F',
    sources: [],
    include: [],
    exclude: [],
    createdAt: now,
    updatedAt: now,
    filePath
  }
}

export function makeTask(overrides: Partial<Task> = {}): Task {
  const now = new Date().toISOString()
  return {
    id: makeId(),
    title: t('task.newTask'),
    description: '',
    type: 'task',
    status: 'todo',
    priority: 'medium',
    start: today().toString(),
    due: '',
    progress: 0,
    completed: '',
    assignees: [],
    tags: [],
    subtasks: [],
    dependencies: [],
    customFields: {},
    collapsed: false,
    createdAt: now,
    updatedAt: now,
    ...overrides
  }
}

export const DEFAULT_PROJECT_COLOR = '#8b72be'
export const DEFAULT_PROJECT_ICON = '📋'

export function makeProject(title: string, filePath: string): Project {
  const now = new Date().toISOString()
  return {
    id: makeId(),
    title,
    description: '',
    color: DEFAULT_PROJECT_COLOR,
    icon: DEFAULT_PROJECT_ICON,
    tasks: [],
    customFields: [],
    teamMembers: [],
    createdAt: now,
    updatedAt: now,
    filePath,
    savedViews: [],
    taskIndex: new Map()
  }
}

export function makeDefaultFilter(): FilterState {
  return {
    text: '',
    statuses: [],
    priorities: [],
    assignees: [],
    tags: [],
    dueDateFilter: 'any',
    showArchived: false
  }
}
