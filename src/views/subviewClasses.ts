import { VIEW_MODES, type ViewMode } from '../types'

/**
 * The class each sub-view puts on the body element it is handed.
 *
 * They all dress the same element, and that element outlives every one of them, so the
 * previous view's class has to come off before the next puts its own on. Left behind, a
 * class that sets `display: flex` keeps governing the next view's children — which is
 * how the dashboard came to be drawn shrink-wrapped and centred in some projects and
 * full width in others, depending only on which view had been looked at before it.
 *
 * Keyed by view and typed against the list of views, so a sixth view cannot be added
 * without giving it a class here: the compiler asks for it. The views read their class
 * from this record rather than spelling it out, which is what makes the list below
 * complete by construction rather than by anyone remembering.
 */
export const SUBVIEW_CLASS = {
  table: 'pm-table-view',
  gantt: 'pm-gantt-view',
  kanban: 'pm-kanban-view',
  library: 'pm-library-view',
  mail: 'pm-mail-view',
  impacts: 'pm-impacts-view',
  dashboard: 'pm-kpi-view'
} as const satisfies Record<ViewMode, string>

/** All of them, for taking the previous view's class off. */
export const SUBVIEW_CLASSES: string[] = VIEW_MODES.map((mode) => SUBVIEW_CLASS[mode])
