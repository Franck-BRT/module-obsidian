/**
 * The class each sub-view puts on the body element it is handed.
 *
 * They all dress the same element, and that element outlives every one of them, so the
 * previous view's class has to come off before the next puts its own on. Left behind, a
 * class that sets `display: flex` keeps governing the next view's children — which is
 * how the dashboard came to be drawn shrink-wrapped and centred in some projects and
 * full width in others, depending only on which view had been looked at before it.
 */
export const SUBVIEW_CLASSES = [
  'pm-table-view',
  'pm-gantt-view',
  'pm-kanban-view',
  'pm-library-view',
  'pm-kpi-view'
] as const
