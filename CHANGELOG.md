# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [2.10.0] - 2026-09-10

### Added

- **Phases** — "lot 1", "lot 2" — a fourth ticket type that gathers tasks inside a
  project. A phase is not a parent task: what it holds is not indented under it and is
  not turned into subtasks, because a task in a lot is still a task of the project
- A phase's dates and progress are read from the tasks it holds, at any depth. Declaring
  a date on the phase itself wins over that, and the Gantt then draws what the work
  actually spans underneath, the part running past the declaration marked apart — a lot
  that says it ends in February while its tasks run into March is the one thing worth
  seeing
- Each view shows a phase the way it can: a folding heading in the table and on the
  board, a summary bracket over its span in the Gantt. Folding is the phase's own
  collapsed state, so it agrees across the three
- The task editor gained a **Phase** picker, and the toolbar a **+ phase** button. A
  ticket created from a phase's heading lands in that phase

### Fixed

- Deleting a task asked its question in English. It is translated now, and deleting a
  phase says how many tasks go with it rather than presenting itself as a small change

### Changed

- A filter no longer strands a phase's tasks: a phase is kept as long as anything it
  holds survives the filter, and its tasks stay inside it instead of being promoted out
  of the lot that names them
- A phase is never scheduled. Its dates come from its tasks, so moving them would be
  overwritten by the next roll-up; it still holds back whatever depends on it, using the
  span of what it holds

## [2.9.0] - 2026-09-10

### Added

- The Gantt and the board group a collection by project too, with the same folding
  headings the table has. What is folded is one answer per collection, not one per view:
  fold a project in the table and it is folded in the board and the Gantt as well
- In the Gantt a heading takes a row of its own and carries a band across the timeline,
  so the label column and the bars stay on the same grid. The board, which already
  groups by status, puts the heading inside each column above that project's cards

### Fixed

- A dependency arrow found its row by counting entries in the flattened task list, which
  stopped being the row number the moment anything else could take a row. It now reads
  the layout the chart was actually drawn from, so arrows and milestone lines land on
  their bars whatever else is on screen. A milestone inside a folded project no longer
  draws a dashed line down a chart it is not in

## [2.8.0] - 2026-09-10

### Fixed

- A collection offered an "Add task" button in its toolbar. A collection owns no
  project, so the task landed in whichever source project happened to come first, and
  did not even join the collection. The table's own add row already knew better; the
  toolbar now does too
- Two strings the French sweep missed: the bulk-delete confirmation was English
  throughout, and the "Moved 3 tasks…" notices counted in English inside an otherwise
  French sentence
- A collection's project heading printed the project's icon setting as text, so a
  project using a Lucide icon read `lucide-toolbox` beside its name. It goes through
  the same glyph renderer as everywhere else now: an icon, an emoji, or a coloured dot
  when the project cannot be resolved

### Changed

- The plugin is now called **Black Projects**, and its id is `black-projects`

### Added

- Settings carry themselves over when the plugin folder changes. On its first load, a
  folder holding no `data.json` of its own reads the one left behind in
  `black-documents` or `dotpm-fr` and adopts it, saying so in a notice. Upstream's
  `project-manager` is deliberately left alone: it may still be installed and running,
  so inheriting its configuration unasked would be a surprise. So this rename costs
  nothing to carry out — unzip, enable, done. Projects and tasks never needed anything
  either way, being plain notes whose frontmatter has never named the plugin

## [2.7.0] - 2026-09-09

### Added

- A collection groups its tasks under the project each one comes from. The heading
  carries the project's icon and colour, says how many tasks it holds, opens the project
  when clicked, and folds shut. What is folded is remembered per collection, so the same
  project can be open in one collection and shut in another
- A task whose project has since moved or been deleted is not dropped from the view: it
  gathers under a "Project not found" heading, last

### Changed

- The table in a collection no longer carries the "Project" column. The heading above
  each block says it once, so the column repeated it on every line and cost the width
  the task titles needed. Every other multi-project view keeps it

## [2.6.1] - 2026-09-09

### Added

- A filtered view can be saved as a collection, from the scope chip. This is how a
  rule-based collection is meant to be made: a view holding real tasks can offer real
  tags and assignees to filter on. The collection's sources are the projects that view
  covered, so a rule built inside one project stays inside it

### Fixed

- An empty collection offered a rule action that could never be used. Its chip invited
  the user to filter the view first, but an empty collection has no filter bar, and one
  would have nothing to offer anyway: tags and assignees are drawn from the tasks in
  scope. It now says what actually works
- Two more interface strings were still English: the add-task and add-milestone buttons


## [2.6.0] - 2026-09-09

### Changed

- The plugin is now called **Black Documents**, and its id is `black-documents`. The
  folder moves with it, so this release needs the same one-off step as 2.4.0: disable
  and remove the old plugin, unzip the new one, and copy `data.json` across. Projects
  and tasks need nothing — the frontmatter keys are untouched and none of them ever
  named the plugin
- Notices, the ribbon and the settings tab carry the new name; the console prefix is
  now `[Black Documents]`
- The README no longer shows upstream's download and star counts under this fork's
  title, and its install steps point here rather than at the community listing

The data format is unchanged. `pm-project`, `pm-task` and `pm-collection` still mean
what they meant, so a vault written by any earlier build opens as it was.


## [2.5.0] - 2026-09-09

### Added

- **Collections**: a named set of tasks drawn from across projects — a reporting pack,
  everything sitting at one status, a theme that cuts through the portfolio. The tasks
  stay in the projects that own them; a collection holds references, and editing one
  from a collection view writes back to its own note
- Membership is a rule, plus what was added by hand, minus what was taken out by hand.
  No rule means a hand-picked list; a rule with no manual entries is a live query; the
  two combine so a rule can be corrected rather than abandoned
- The filter bar doubles as the rule editor: filter the view, then save those filters as
  the collection's rule from the chip in the toolbar
- Collections appear in the dashboard under the projects, with their own progress; a
  task joins one from its context menu, and leaves from the same menu inside a collection

### Fixed

- Four interface strings were still English: the new-project button, the project count,
  the past-due count and the folder scope label. They were lower-case prose that the
  translation sweep's heuristic mistook for code


## [2.4.0] - 2026-09-09

First release of the `Franck-BRT/module-obsidian` fork, from upstream dotpm 2.3.1.

The plugin id is `dotpm-fr`, not upstream's `project-manager`, so this build installs
beside the community plugin instead of being overwritten by its next update. Disable
the original before enabling this one — two copies both claiming the vault's project
notes will fight. Settings carry over by copying `data.json` from the old plugin
folder to the new one; task and project notes need nothing, they are plain Markdown.

### Added

- The interface is translated, French to start with. The language follows Obsidian's
  own unless the new Language setting overrides it, and an untranslated string falls
  back to English rather than showing a key
- Scheduling can skip weekends and holidays, with a configurable working week. Off by
  default: turning it on would otherwise move the dates of every existing plan
- Dependencies carry a link type — finish-to-start, start-to-start, finish-to-finish,
  start-to-finish — and a lag in working days, negative to overlap the predecessor
- Recurring tasks create their next occurrence when completed, subtasks included

### Fixed

- Content written by hand into a project note survives a save. The body was
  regenerated whole, so anything added to it was dropped silently
- Tasks caught in a dependency cycle are reported. They were detected and then
  discarded, so they quietly stopped being scheduled
- `pnpm dev` builds into the folder named by the manifest rather than a hard-coded id


## [2.3.1] - 2026-09-07

### Fixed

- Status, priority, date and tag pickers opened outside the dialog when a theme applied a blur or transform to dialogs ([#276](https://github.com/dotpm/obsidian-pm/issues/276))

## [2.3.0] - 2026-09-07

### Added

- The shortcut that saves a task and creates a project can be changed between Shift+Enter and Ctrl/Cmd+Enter

### Changed

- The new project dialog creates the project with the save shortcut or its create button

### Fixed

- Undo while typing in a dialog reverted the last task change when a Gantt view was open
- Saving a task or project removed the properties that other plugins or the user had added to its note ([#272](https://github.com/StepanKropachev/obsidian-pm/issues/272))

## [2.2.0] - 2026-09-06

### Added

- The timeline has a year zoom level, showing quarters under each year ([#50](https://github.com/StepanKropachev/obsidian-pm/issues/50), [#77](https://github.com/StepanKropachev/obsidian-pm/issues/77), [#147](https://github.com/StepanKropachev/obsidian-pm/issues/147))
- A project can be duplicated with all its tasks, from the project list's context menu or the duplicate project command
- The plugin's entry in Obsidian's plugin list links to the author's funding page

### Changed

- The plugin is now called dotpm, matching the [dotpm](https://dotpm.pm) organization the repository moved to ([#269](https://github.com/dotpm/obsidian-pm/issues/269)). Commands are listed under **dotpm** in the Command Palette instead of **Project Manager**. Existing hotkeys, settings, and task files are unaffected, and updates continue as before.
- Subtasks, parents and dependencies appear in the graph view and in a note's properties as links

### Fixed

- Edits, dependency checks, and archiving could act on the wrong project when one project was created by copying another's folder
- The expand/collapse triangle was hard to click in the table, project list and Gantt views ([#266](https://github.com/dotpm/obsidian-pm/pull/266))
- A task's due date in the table kept only the first digit typed and closed before the rest could be entered

## [2.1.0] - 2026-08-27

### Highlights

- **Auto-archive:** Completed tasks move into the project's archive on their own after a number of days you choose, set once for every project or overridden by a project in its own settings, and the archive completed tasks command does the same sweep right away.
- **Inherited custom fields:** Custom fields can be defined once for the whole vault or on a parent project, and every project underneath starts with them. Each project can still rename, retype, or hide a field it inherits, and a field it already had of its own can be merged into the inherited one, values and all.

### Added

- Completed tasks move to the project's archive after the number of days set in the new auto-archive setting ([#204](https://github.com/StepanKropachev/obsidian-pm/issues/204))
- A project can override the auto-archive window in the project settings
- The archive completed tasks command moves finished tasks into the archive right away
- A sub-project has the custom fields its parent project defines ([#255](https://github.com/StepanKropachev/obsidian-pm/issues/255))
- Custom fields can be defined for the whole vault, so every project starts with them
- A project can rename, retype, or hide a custom field it inherits, in the project settings
- A custom field that duplicates an inherited one can be merged into it, values and all

### Fixed

- Renaming a project from its settings page left its note and folder named after the old title
- A view failed to load when a note's properties held an invalid value for team members, assignees, tags, or dependencies ([#252](https://github.com/StepanKropachev/obsidian-pm/issues/252))
- A sub-project or subtask nested two levels deep drew a leftover connector line beside it when its parent was the last of its siblings

## [2.0.0] - 2026-08-25

### Highlights

- **Breaking change:** the plugin now requires Obsidian 1.13 or later, so update Obsidian before installing this release.
- **Project overviews:** Opening a project now shows its own page, with progress, description, a milestone timeline, sub-projects, and properties. Plus a new setting that can switch this back to opening straight into the task list. It's up to you.
- **Sub-projects and multi-project views:** Projects can nest under a parent, and the table, board, and timeline can show a project's subtree, its folder, or the whole vault at once, with their own saved views and filters.
- **A folder per project:** Each project now keeps everything together in one folder, and old existing projects migrate to the new structure automatically.
- **Cross-project dependencies:** A task can depend on or block work in another project, with its schedule following the dates of the project it depends on.
- **Custom priorities and per-project config:** Priorities can be added, renamed, recolored, and reordered, and a project can define its own statuses, priorities, default view, and scheduling behavior in its settings
- **Progress and completion timing:** A task's progress can be set directly from 0 to 100, and a completed task shows whether it finished on time or how many days late it was
- **People notes:** Assignees and project members can be linked to the person notes in your vault, with avatars, a note created automatically for a new name, and commands that list everything one person is working on
- **Better wikilinks:** Names, custom fields, and project links written as wikilinks resolve to the note they point to wherever they show up. We all love those nice obsidian graphs!
- **Improved custom fields style:** A custom field now uses the same controls as a task's built-in properties, so a custom date opens the date picker and a custom select shares status's popover, and in the table a link or person field shows as a link or an avatar instead of raw text, and a checkbox renders as a proper checkbox
- **A searchable icon picker:** Status, priority, and project icons are chosen from a grid of every icon Obsidian knows, or set to any emoji
- **Settings rework:** Settings are grouped by area, with statuses, priorities, team members, and TaskNotes each on their own page, and can be found through Obsidian's own settings search.
- **Tasks in tabs:** Tasks can open in a tab instead of a modal, with the task editor hosted as a page of its own
- **TaskNotes import:** Tasks, statuses, and priorities can be imported from TaskNotes, including dates, dependencies, subtasks, tags, and archive state
- **A lighter index behind the scenes:** The project list, pickers, and due-date reminders read from a lightweight index instead of re-parsing every project file, so they stay quick even in very large vaults
- **Updated sync engine:** A task or project open in several tabs or views stays in sync: an edit in one place shows up in all the others right away

### Added

- Assignees and project members can be picked from the person notes already in your vault, so the task links to them and they appear in the graph ([#131](https://github.com/StepanKropachev/obsidian-pm/issues/131))
- A person with no note yet gets one created from the assignee picker, in the new people folder setting
- Clicking an assignee's avatar opens that person's note
- The show tasks assigned to a person command lists everything one person is working on, across every project
- A person note opened in the editor shows that person's tasks with the show tasks assigned to this note command
- The link assignees to their person notes command turns typed names into links to the notes of the same name
- Opening a project from the project list shows its overview: progress, description, milestones, sub-projects, and properties
- Clicking a project opens its tasks instead of its overview when the open projects in setting is set to tasks
- A row, card, or timeline label naming its project opens that project when clicked
- Projects are listed wherever their files live in the vault
- A project can sit under another one, chosen in the project settings
- The project list nests sub-projects under their parent, whose card counts the tasks of the whole group
- Folders can be left out of the project list with the new excluded folders setting
- The rebuild project index command looks through the vault for projects again
- The table, board, and timeline can show several projects at once, chosen from the switcher next to the project name
- The open all projects command puts every project in the vault in one view
- Rows, cards, and timeline labels name their project when a view covers more than one
- Saved views and filters belong to the set of projects on screen, so a project and its sub-projects keep separate ones
- A task can depend on a task in another project, and its dates follow that one
- The task editor lists the tasks a task blocks, wherever they live
- The task menu moves a task and its subtasks to another project
- A timeline row says when a task depends on something outside the view
- Priorities can be added, renamed, recolored, and reordered in settings
- Priority icons can be switched between chevrons, signal bars, arrows, alerts, or none, globally or per project
- Status and priority icons are picked from a searchable grid of every icon Obsidian knows, or set to an emoji by pasting one into its search field
- A project's icon is picked from that same grid, so it can be any icon Obsidian knows and not only an emoji
- TaskNotes tasks can be imported with their dates, dependencies, subtasks, tags, and archive state ([#16](https://github.com/StepanKropachev/obsidian-pm/issues/16))
- Statuses and priorities can be imported from TaskNotes in settings ([#16](https://github.com/StepanKropachev/obsidian-pm/issues/16))
- Projects can define their own statuses and priorities in the project settings, replacing the global ones ([#57](https://github.com/StepanKropachev/obsidian-pm/issues/57))
- Projects can override the default view, auto-scheduling, and the board display options in the project settings
- The completed date shows whether a task finished on time or how many days late it was
- Task progress can be set from 0 to 100 in the task editor and by clicking the progress bar in the table
- Dependent tasks move earlier when a task is completed before its due date, using the new pull-forward setting ([#154](https://github.com/StepanKropachev/obsidian-pm/issues/154))
- Tasks open in a tab instead of a modal when the new task opening setting is set to tab
- A task note opens in the task editor when tasks are set to open in a tab
- The task menu moves the task being edited into a tab
- Subtasks in the table are joined to their parent by tree lines, which can be turned off with the new show subtree connections setting
- The table draws lines between rows, between columns, or both, using the new line borders setting

### Changed

- A project keeps its note and its task notes together in a folder of its own
- An existing project moves into its own folder when the vault is opened, keeping its filters, saved views, and open tabs
- A new sub-project is created inside its parent's folder
- Renaming a project note renames the folder it owns, so the two keep matching
- Deleting a project deletes its folder, unless a sub-project sits inside it
- The tags offered in the task editor are listed alphabetically
- Custom fields in the task editor use the same controls as the task's own properties, so a custom date opens the date picker and a custom select the same popover as status
- Project members, the global team members, and task assignees are picked from the same control, which searches the people in your vault and offers to create the note for a new name
- The people a picker offers include the global team members, the project's own members, and everyone already assigned in that project
- A person already picked as a plain name shows as picked when the same person is found as a note
- The project name above the table, timeline, and board opens that project's overview when clicked. Previously it was an editable field for renaming the project
- Assignee lists sort by the name shown rather than by the link behind it
- The project list is a table of rows with progress, task counts, members, and the last due date, replacing the cards
- The project list counts how many projects have tasks past due
- Sub-projects in the project list are joined to their parent by tree lines, which can be turned off with the show subtree connections setting
- The project list draws lines between rows, between columns, or both, following the line borders setting
- Project settings open in a page of their own, keeping each change as it is made
- Creating a project asks for its name, icon, color, parent, members, and description in one dialog
- The new project dialog is laid out like the task editor, with a large name field and a properties grid
- A project's color is chosen from the color picker, replacing the ten preset swatches
- The projects folder setting decides where new projects are created, not which projects the plugin shows
- Table rows have no line between them unless line borders are turned on
- The plugin requires Obsidian 1.13
- Settings are grouped by area, with statuses, priorities, team members, and TaskNotes each on their own page
- Settings can be found from Obsidian's settings search
- The TaskNotes page shows how many statuses and priorities differ before importing
- A setting that depends on another one is unavailable until that one is turned on
- Add buttons in the table, Gantt, project editor, and settings share one quiet style
- Remove buttons in the task editor, project editor, and settings are icon buttons with tooltips
- The import dialog uses Obsidian's native buttons
- The Gantt zoom control uses Obsidian's native buttons
- Filter and saved-view buttons match Obsidian's native buttons, with an accent tint when active
- The cursor lands where a task description was clicked when the editor opens
- Subtasks are archived and unarchived along with their parent task
- The time tracking section in the task editor no longer shows a progress bar
- The kanban card no longer shows a subtask count next to the progress bar
- Every property row in the task editor is the same height
- Section labels in the task editor are smaller and lighter
- A completed subtask is crossed out in the task editor
- The field for adding a subtask lines up with the subtasks above it
- Tasks listed under Depends on and Blocks open in the task editor when clicked
- The Blocks list in the task editor is a list of tasks like Depends on, replacing the chips
- A timeline row saying a task depends on something outside the view opens those tasks when clicked
- A subtask in the task editor opens in its own editor when clicked
- A subtask is renamed in its own editor rather than by typing in the subtasks list

### Fixed

- Due dates read a day early on the board, the table, the project list, and a project overview for anyone whose clock is behind UTC
- A status or priority with an icon showed none of it in the filter dropdowns and the bulk action bar
- A project icon picked from the icon grid showed its name as text in the project list, the toolbar, the overview, the project settings, and the project picker
- Clearing a number custom field wrote an invalid value into the task's note
- A custom field holding a link showed as raw link text in the table
- A person custom field showed the stored text in the table instead of that person's avatar
- A person custom field lost the link to the person's note when set in the task editor
- A checkbox custom field showed true or false in the table
- A url custom field was plain text in the table
- The assignees on a project's overview did not open their notes when clicked
- An assignee whose name is a link showed as raw link text in the assignee filter, the bulk assign menu, the timeline tooltip, and the task editor
- The assignee filter skipped tasks that wrote the same person's name a different way
- Two people with the same name were treated as one by the assignee filter, when each had their own note
- A task title sat above the middle of its row when another column made the row taller
- A change made in one view of a project was undone by the next click in another view of the same project ([#173](https://github.com/StepanKropachev/obsidian-pm/issues/173))
- A project open in two views showed the older state in one of them ([#173](https://github.com/StepanKropachev/obsidian-pm/issues/173))
- A task edited in the task editor lost changes made to it elsewhere while the editor was open
- Edits to a project file made outside the plugin reached an open project view only after reopening it
- A settings change reached an open project or project list only after reopening it
- The table stopped short of its last rows and left empty space below them when scrolled to the bottom
- The sort arrow in the table stayed on the column that was sorted before
- Start and completed dates were labelled overdue in the task editor ([#156](https://github.com/StepanKropachev/obsidian-pm/issues/156))
- The due date of a done task was labelled overdue in the task editor ([#156](https://github.com/StepanKropachev/obsidian-pm/issues/156))
- The due date of a done task was highlighted as urgent in the table
- Text and images in a task description could not be selected or copied ([#169](https://github.com/StepanKropachev/obsidian-pm/issues/169))
- A task description rewrapped its text when clicked for editing
- Searching for a task by its id found nothing ([#167](https://github.com/StepanKropachev/obsidian-pm/issues/167))
- The import dialog offered the built-in statuses and priorities instead of the configured ones
- The task editor showed two close buttons in its top right corner
- The add property button in the task editor touched the custom fields section below it
- The task editor left more space around the line under the properties than around its other section lines

## [1.8.0] - 2026-07-03

### Added

- The gantt timeline header stays pinned to the top when scrolling through tasks
- Selected text in a note can be turned into a task from the right-click menu or the "Create task from selection" command

## [1.7.0] - 2026-07-02

### Added

- New setting "Show tag colors" (default on) controls the presence of a colored dot on tags
- Copy the task ID or file path to the clipboard by clicking the corresponding header or footer text in the task editor

### Changed

- Design overhaul of the task modal, with improved UX and unified components
- Status, priority, type, and dates on a task are now changed via a value picker
- Tags, assignees, and dependencies are edited through a new searchable picker
- Repeat and dependencies are hidden by default and added to a task on demand from an "Add property" menu
- Archive, delete, and opening a task as a note are grouped under a single menu in the task editor
- Subtask progress is calculated only from completed subtasks
- Assignee avatars stack when more than one person is assigned
- Checkbox style now matches the one on the task table
- Task priority is shown with a colored chevron instead of a dot
- A value picker in the task editor sizes to its options instead of a fixed width
- Tags in the task table and on kanban cards show a colored dot, matching the task editor
- Logged time is shown the same way in the task table and on kanban cards

### Fixed

- The task editor's priority strip is now displayed along the top edge of the window
- The task editor title showed an input background when hovered or focused
- Time tracking shows the over-estimate state once logged time passes the estimate

## [1.6.3] - 2026-06-17

### Fixed

- The project view was empty when Pane Relief or Hover Editor was enabled ([#80](https://github.com/StepanKropachev/obsidian-pm/issues/80))

## [1.6.2] - 2026-06-17

### Changed

- Task note filenames keep more of the task title before shortening

### Fixed

- Subtasks added in the task editor were lost on reload ([#90](https://github.com/StepanKropachev/obsidian-pm/issues/90))
- The app froze when duplicating a task with a long title
- The project list showed stale task counts until the view was reopened ([#121](https://github.com/StepanKropachev/obsidian-pm/issues/121))

## [1.6.1] - 2026-06-15

### Changed

- Task and project modals follow Obsidian's native border, shadow, and corner styling
- Status, priority, and tag labels follow Obsidian's native styling
- The accent color follows the Obsidian theme
- Gantt elements follow the Obsidian theme: the today marker, the milestone and subtask buttons, and the row selection and hover highlights
- Kanban cards align the assignee and due date to the bottom of the card

### Fixed

- Subtasks created from the subtasks list or the add-subtask buttons were not set to the subtask type ([#82](https://github.com/StepanKropachev/obsidian-pm/issues/82))
- An assignee written as a note link (`[[People/Jane Doe]]`) showed the link path on its avatar instead of the person's name ([#64](https://github.com/StepanKropachev/obsidian-pm/issues/64))

## [1.6.0] - 2026-06-12

### Added

- Completing a task records a completion date that can be edited in the task modal ([#93](https://github.com/StepanKropachev/obsidian-pm/issues/93))
- Setting "Show description preview on board" (default off) shows the first three lines of each task's description on its kanban card ([#59](https://github.com/StepanKropachev/obsidian-pm/issues/59))

### Changed

- Saving a task updates only the affected task notes instead of every note in the project
- Projects open faster, and reopening a project is instant. Edits made outside the plugin are still detected and reloaded
- The table stays responsive in large projects
- Views update in place after an edit, keeping the scroll position and selection
- Select all in the table selects every task matching the current filter, not just the visible rows
- Collapsing or expanding a subtree no longer changes any task notes
- The expand/collapse subtasks toggle looks the same in the table and Gantt views
- Gantt task bars show stronger contrast between completed and remaining work ([#87](https://github.com/StepanKropachev/obsidian-pm/issues/87))
- Gantt task bars no longer show a stripe on tasks that have subtasks

### Fixed

- Images pasted or dropped onto a task were saved to the vault root instead of the task's own folder. The folder follows the task when it is renamed or archived, and is removed with the task
- Duplicating a task with its subtasks failed with a "note already exists" error and dropped the subtasks ([#90](https://github.com/StepanKropachev/obsidian-pm/issues/90))
- Progress bar labels showed 0% instead of the actual value in some views
- The subtasks toggle did not respond in the Gantt view

## [1.5.0] - 2026-05-25

### Added

- Setting "Save tasks on close" (default on). When off, closing the task modal by X or click-outside discards edits, so only the Save button keeps them ([#62](https://github.com/StepanKropachev/obsidian-pm/issues/62))
- "Open as note" button in the task modal header opens the task's note in a new tab
- Pasting a screenshot or dragging a file onto the task description saves it to the vault attachments folder and embeds it at the cursor
- Search box, filters (status, priority, assignee, tag, due date, archived), and saved views appear above every view, not just the table
- Filter state persists per project across plugin reloads
- Saved views remember the view mode they were created in, and selecting one switches the project to that mode
- Gantt lifts a matching task to the top level when its parent is filtered out, so search reveals deeply nested matches
- Release artifacts carry GitHub build provenance attestations; `gh attestation verify <file> --owner StepanKropachev` confirms a download was built from this repo

### Changed

- The UI follows the Obsidian theme: accent color, near and overdue colors, badges, and avatars
- Toolbar, Gantt, filter, and bulk-action buttons render at Obsidian's native size
- Saved-view tabs match the styling of the filter pills
- The "save view" and inline add buttons render as native Obsidian buttons
- Status and priority badges in the task modal are no longer keyboard-focusable
- The delete confirmation uses Obsidian's native warning style
- Primary buttons in light theme use a solid accent fill
- The project header gear, bulk-action clear, remove, and table row buttons use Obsidian's icons
- Remove buttons on tags, assignees, and dependencies turn red on hover
- Project-card and kanban-card progress bars are 3px tall
- The filter row collapses when no filters are active, and the Filter pill expands it
- Toggling a filter pill no longer moves focus out of the search box
- Gantt milestone labels and dependency arrows follow the active filter
- View switcher buttons show only an icon
- Assignee avatar initials use the first letter of the first two words, so "Michael Jordan" shows "MJ" instead of "MI"
- New task notes are named after the task title. Existing notes keep their name until the task is renamed

### Removed

- The Gantt "Hide completed" button; the Status filter excludes Done and Cancelled instead, and existing settings migrate automatically
- The inline quick-add input above the table; the toolbar "add task" button opens the task modal instead

### Fixed

- A solo avatar had extra spacing on its right in the project edit modal
- Kanban cards dropped the fourth and later assignees
- Duplicate task entries appeared when creating a task
- A saved-view pill stayed highlighted after its filter was changed
- An assignee stored as a wiki link (`[[Wiki Link]]`) showed garbled avatar initials ([#64](https://github.com/StepanKropachev/obsidian-pm/issues/64))
- Renaming a task to a title already used by another note shows an inline error instead of failing silently

## [1.4.0] - 2026-04-29

### Breaking Changes

- Clicking a project file no longer auto-opens the project view. The new "Open current file as project" command restores the old behavior when bound to a hotkey

### Added

- Duplicate task action in the table and Kanban context menus
- "Open current file as project" command

### Fixed

- "Today" rolled over in the evening west of UTC
- Clicking a project from a task tab hijacked the tab
- Opening a project created duplicate tabs
- The ribbon button opened a duplicate project list pane
- The table scroll position was lost across opening and closing the task modal
- Project folders errored on case-insensitive vaults

## [1.3.2] - 2026-04-21

### Fixed

- `file://` links in task descriptions did not open on click

## [1.3.1] - 2026-04-21

### Added

- Redo for Gantt drag actions (Cmd+Shift+Z, Cmd+Y, or the "Redo last action" command)

### Fixed

- Cmd+Z no longer hijacks undo in unrelated notes when a project tab is open

## [1.3.0] - 2026-04-18

### Added

- Custom task statuses, added and removed from settings
- Subtasks as draggable cards on the Kanban board
- Undo for Gantt drag operations (Ctrl/Cmd+Z)
- Interactive checkboxes in the task description preview
- "Hide completed tasks" toggle in Gantt
- Bulk set-parent and remove-parent in the table view

### Removed

- The emoji placeholder in the custom status icon input

### Fixed

- The bulk action bar flickered when toggling filters
- Orphaned subtasks reattach to their parent on load
- Orphaned tasks are remapped when a custom status is deleted

## [1.2.0] - 2026-04-14

### Added

- Import notes as tasks: batch-import vault notes into a project through a multi-file picker
- Click-to-link dependencies on Gantt
- Drag Gantt task bars to reposition them
- Click an empty Gantt row to set start and due dates
- Dependency-based auto-scheduling
- Type `[[` in the description field to link vault notes
- Markdown preview in task descriptions, with a toggle between edit and rendered
- Shift+click range selection for table checkboxes
- Gantt week labels: week number, date range, or both

### Changed

- The dependency picker filters out cycles
- Cross-links to canvases and databases work in task descriptions
- Bulk checkboxes stay hidden until the row is hovered
- Task modal buttons show the Shift+Enter shortcut hint

### Fixed

- Dependent tasks lost a day on each reschedule
- The Gantt scroll position was lost on re-render
- The import modal wrote tasks to the wrong folder
- Subtasks did not render when added through the parent task modal
- Deleting dependent tasks crashed the plugin
- The task modal jumped while typing long descriptions
- Import modal checkboxes responded slowly and double-toggled

## [1.1.1] - 2026-04-11

No release notes. See the [1.1.0...1.1.1 diff](https://github.com/StepanKropachev/obsidian-pm/compare/1.1.0...1.1.1).

## [1.1.0] - 2026-04-08

First stable release.

### Added

- Gantt: drag-to-reschedule, snap-to-grid, resizable sidebar, milestones, and week/month/quarter scales
- Kanban: drag-and-drop board grouped by status
- Table: sort, filter, saved views, inline date editing, and a quick-add bar
- Task modal: subtasks panel, time tracking, custom fields, and auto-save on dismiss
- Bulk actions: multi-select for status changes, deletion, and archive/unarchive
- Custom fields per project: text, number, date, checkbox, select, and multi-select
- Archive system with a toggle to show archived tasks
- Command palette: create tasks and open projects from anywhere
- Tasks stored as YAML frontmatter in Markdown files

## [1.0.0-beta] - 2026-03-30

Initial beta.
