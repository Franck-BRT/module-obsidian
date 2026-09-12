import { today } from './dates'
import type { TaskIndex } from './store/TaskIndex'
import type { WorkCalendar } from './store/WorkCalendar'
import type { LanguageSetting } from './i18n'
import { t } from './i18n'

export type TaskStatus = string
export type TaskPriority = string
export type GanttGranularity = 'day' | 'week' | 'month' | 'quarter' | 'year'
export type GanttWeekLabel = 'weekNumber' | 'dateRange' | 'both'
/**
 * The views a project can be looked at through, in the order their switcher offers them.
 * A list rather than a bare union, so the places that have to recognise every view —
 * the saved-view reader, the default-view setting — are derived from it and cannot be
 * left a view behind.
 */
export const VIEW_MODES = ['table', 'gantt', 'kanban', 'library', 'dashboard'] as const
export type ViewMode = (typeof VIEW_MODES)[number]
export type LineBorders = 'none' | 'horizontal' | 'vertical' | 'both'
export type DueDateFilter = 'any' | 'overdue' | 'this-week' | 'this-month' | 'no-date'
export type TaskType = 'task' | 'milestone' | 'subtask' | 'phase' | 'document'

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

/**
 * Where a document stands. The order is the life of a deliverable: it is expected, it
 * arrives, someone reads it, someone signs it off — or a later issue makes it obsolete.
 */
export type DocState = 'expected' | 'received' | 'in-review' | 'approved' | 'obsolete'

export const DOC_STATES: readonly DocState[] = ['expected', 'received', 'in-review', 'approved', 'obsolete']

/** One deposit. Kept even once superseded: that is what an archive is for. */
export interface DocVersion {
  /** Counts deposits, never reused, so v3 means the third file that ever landed here. */
  version: number
  /** Where that file is now — the current one, or its place in the versions folder. */
  file: string
  at: string
  by: string
  note: string
}

export interface DocApproval {
  by: string
  at: string
  verdict: 'approved' | 'rejected'
  note: string
}

/**
 * The documentary side of a ticket of type `document`. It sits beside the task fields
 * rather than inside them, so everything that walks a task — the scheduler, the filters,
 * the views — carries on unchanged and only the library has to know about any of it.
 */
export interface DocumentMeta {
  state: DocState
  /** The current file, or '' while the document is still only expected. */
  file: string
  /** The file lives outside the project and is referenced where it is, never moved. */
  linked: boolean
  /** Reference or code, as the trade uses it: PL-001, CCTP-03. */
  reference: string
  /** Revision mark, the letter or number a drawing carries: A, B, 02. */
  issue: string
  issuer: string
  recipient: string
  phase: string
  approvers: string[]
  approvals: DocApproval[]
  versions: DocVersion[]
}

export function makeDocument(overrides: Partial<DocumentMeta> = {}): DocumentMeta {
  return {
    state: 'expected',
    file: '',
    linked: false,
    reference: '',
    issue: '',
    issuer: '',
    recipient: '',
    phase: '',
    approvers: [],
    approvals: [],
    versions: [],
    ...overrides
  }
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
  /** Set on a ticket of type `document`: its file, its versions, its approvals. */
  // oxlint-disable-next-line obsidianmd/prefer-active-doc -- a field, not the global
  document?: DocumentMeta
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
  /** Collection path -> the project headings folded shut inside it. */
  collapsedCollectionGroups: Record<string, string[]>
  /** How the library shows documents: as a register, or as thumbnails. */
  libraryMode: 'list' | 'cards'
  /** How the Gantt orders rows. 'manual' keeps the order the project stores. */
  ganttSortKey: 'manual' | 'title' | 'status' | 'priority' | 'due' | 'assignees' | 'progress'
  ganttSortDir: 'asc' | 'desc'
  /**
   * How the board orders the cards inside a column — its own setting, not the Gantt's: a
   * chart read by date and a board read by priority are two ways of looking at the same
   * project, and choosing one should not disturb the other.
   */
  kanbanSortKey: PMSettings['ganttSortKey']
  kanbanSortDir: 'asc' | 'desc'
  /**
   * How the library lists documents. Its keys are the document's own fields, not a
   * task's: 'reference' is the order a register has always been in, and the default.
   */
  librarySortKey: 'reference' | 'title' | 'state' | 'due' | 'issue' | 'issuer' | 'deposited'
  librarySortDir: 'asc' | 'desc'
  /**
   * How the table orders rows. Kept here so a header clicked in one project is still
   * the order the next one opens in — the column arrows alone never outlived a reload.
   */
  tableSortKey: PMSettings['ganttSortKey']
  tableSortDir: 'asc' | 'desc'
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
  collapsedProjects: [],
  collapsedCollectionGroups: {},
  libraryMode: 'cards',
  ganttSortKey: 'manual',
  ganttSortDir: 'asc',
  kanbanSortKey: 'manual',
  kanbanSortDir: 'asc',
  librarySortKey: 'reference',
  librarySortDir: 'asc',
  // Status, which is what the table has always opened in: an upgrade reorders nothing.
  tableSortKey: 'status',
  tableSortDir: 'asc'
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
