# Screens

The plugin's screens rendered in Chromium from the demonstration's data, to be looked
at without Obsidian: `stub.ts` stands in for the Obsidian API in the browser (DOM
helpers, modals, notices, lucide icons), `obsidian-base.css` for the default theme.

```sh
./build.sh                                   # icons, stylesheet, bundles
node shot.mjs reserves:light:1280 budget:dark:1280 gantt:light:1400 reserves:light:390
node pdfs.cjs shots                          # PV de réception and status report as PDF
```

A shot is `screen:theme:width[:height[:lang]]`; screens are listed in `entry.ts`
(`reserves`, `budget`, `budget-open`, `gantt`, `reserve-panel`, `ics`, `planning`,
`weekly`). Each lands in `shots/`, full page. The script reports page errors, icons
lucide does not have, and pages wider than their window.

Needs Playwright's Chromium (`/opt/pw-browsers`, or set `CHROMIUM`).
