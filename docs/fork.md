# This fork

**Black Documents** (`Franck-BRT/module-obsidian`) is a fork of
[`dotpm/obsidian-pm`](https://github.com/dotpm/obsidian-pm), MIT-licensed, forked at
**2.3.1**. Upstream is actively developed, so this fork tracks
it rather than diverging: our changes ride on top and upstream releases are merged in.

## What this fork adds

| Change | Why |
| --- | --- |
| Hand-written content in project notes survives a save | `serializeProject` regenerated the whole body, dropping anything the user typed into the note |
| Dependency cycles are reported | `computeSchedule` detected them and every caller discarded the result, so looped tasks silently stopped being scheduled |
| Scheduling skips weekends and holidays | Dates were plain calendar days, so a dependent could start on a Saturday. Off by default |
| Recurring tasks actually repeat | `interval`, `every` and `endDate` were written, badged, and never read back |
| Typed dependencies (FS/SS/FF/SF) and lag | Every link meant finish-to-start with exactly one day between the two tasks |
| French translation, and the machinery for any other | Every string was hard-coded English |
| Collections gathering chosen tasks across projects | No way to see tasks from several projects as one named set |

Each is one commit, kept self-contained so a conflict during a merge is confined to it.

## Keeping up with upstream

The upstream remote is already configured as `upstream` (push disabled):

```sh
git remote -v          # origin = this fork, upstream = dotpm/obsidian-pm
```

To take a new upstream release:

```sh
git fetch upstream
git checkout main
git merge upstream/main       # main tracks upstream untouched
git push origin main

git checkout <work-branch>
git merge main                # resolve conflicts in our commits only
pnpm install && pnpm test && pnpm run check
```

`main` is kept as a clean mirror of upstream, so the diff that is ours is always
`main..<work-branch>`.

## Where conflicts are likely

Our changes are deliberately narrow, but these are the files upstream is most likely
to touch at the same time:

- `src/store/Scheduler.ts` — the placement loop was restructured to compute a start
  bound and a finish bound instead of a single latest due date.
- `src/store/YamlSerializer.ts` / `YamlHydrator.ts` — two new frontmatter keys,
  `dependencyOptions` on a task and `respectWorkingDays` in a project's config.
- `src/store/ProjectStore.ts` — `spawnNextOccurrence` and `reportCycles`, plus the
  body remainder passed to `serializeProject`.
- Any file holding interface text: its strings now read `t('some.key')` rather than
  sitting inline, so an upstream edit to a string conflicts with the `t()` call. The
  fix is always the same — put the new wording in `src/i18n/en.ts` and translate it
  in `fr.ts`.

What we deliberately did **not** change, to keep merges cheap:

- `Task.dependencies` is still a plain `string[]` of ids. Link type and lag live
  beside it in an optional map, so the graph, the cycle checks, the index and every
  view are untouched.
- A vault that uses none of the new features produces byte-identical notes.

## Translations

`src/i18n/en.ts` is the source catalogue; `fr.ts` translates it. A key the active
language has not translated falls back to English, so a merge that brings in new
English strings degrades gracefully instead of breaking the interface — and two
checks make sure the gap does not go unnoticed:

- `i18n.test.ts` fails, naming every key French is missing, and checks that the
  placeholders and the plural shape match across locales.
- `pnpm run check:i18n` fails on any catalogue key nothing reads, which is what a
  string translated but never swapped in at its call site looks like.

The language follows Obsidian's own unless the plugin's Language setting overrides it.
Adding a locale means one file, one entry in `LOCALES`, and nothing else.

## Installing it

The plugin id is **`black-documents`**, not upstream's `project-manager`. That is
deliberate: sharing the id means sharing the folder, and Obsidian would eventually
overwrite this build with an upstream release without saying anything.

1. Disable any other copy in Obsidian — upstream **dotpm**, or an earlier **dotpm FR**
   build of this fork. Two copies both claiming the vault's `pm-project` notes will
   fight over them.
2. Unzip `black-documents-<version>.zip` into `<vault>/.obsidian/plugins/`, or copy
   `main.js`, `manifest.json` and `styles.css` into
   `<vault>/.obsidian/plugins/black-documents/`.
3. To keep your settings, copy the `data.json` from whichever folder you were using —
   `project-manager` for upstream, `dotpm-fr` for a 2.4 or 2.5 build of this fork:
   `cp <vault>/.obsidian/plugins/dotpm-fr/data.json <vault>/.obsidian/plugins/black-documents/`
   Projects and tasks need nothing — they are plain Markdown notes and belong to the
   vault, not to the plugin. The frontmatter keys are unchanged, so nothing in them
   refers to the plugin's name.
4. Reload Obsidian and enable **Black Documents**.
5. Once it works, delete the old plugin folder so the two cannot both index the vault.

For updates without doing this by hand, [BRAT](https://github.com/TfTHacker/obsidian42-brat)
can follow this repository's releases: add `Franck-BRT/module-obsidian` as a beta plugin.

## Cutting a release

```sh
pnpm check && pnpm test        # must be clean
# bump `version` in manifest.json and add it to versions.json
pnpm build && pnpm package     # dist/black-documents/ and its zip
git tag <version> && git push origin <version>
```

The tag triggers `.github/workflows/release.yml`, which rebuilds from the tag, refuses
to publish if the tag and `manifest.json` disagree or the version is missing from
`versions.json`, and attaches `main.js`, `manifest.json` and `styles.css` to a GitHub
release. Those three loose files are what Obsidian and BRAT install; the zip is only a
convenience for installing by hand.

## Running it

```sh
pnpm install
pnpm test          # 544 tests
pnpm run check     # lint, format, types, submission lint
pnpm run build     # main.js + styles.css
VAULT_PATH=/path/to/vault pnpm run dev   # builds straight into the vault's plugin folder
```
