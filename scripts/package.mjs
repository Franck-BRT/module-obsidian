// Collects a built plugin into dist/ and zips it.
//
// Obsidian and BRAT both want the three files loose — main.js, manifest.json,
// styles.css — so those are what the release carries. The zip is only a convenience
// for installing by hand: unzip it into .obsidian/plugins/ and the folder is already
// named after the plugin id.
//
// Run `pnpm build` first; this script refuses to package a stale or missing build.
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'))
const FILES = ['main.js', 'manifest.json', 'styles.css']
// manifest.json is a source file, not a build output: its age says nothing about
// whether the build is current.
const GENERATED = ['main.js', 'styles.css']

const missing = FILES.filter((f) => !existsSync(join(root, f)))
if (missing.length) {
  console.error(`package: ${missing.join(', ')} missing. Run \`pnpm build\` first.`)
  process.exit(1)
}

// A build older than the sources it came from is worse than no build: it packages
// code nobody reviewed.
function newestUnder(dir) {
  let newest = 0
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    newest = Math.max(newest, entry.isDirectory() ? newestUnder(full) : statSync(full).mtimeMs)
  }
  return newest
}

const built = Math.min(...GENERATED.map((f) => statSync(join(root, f)).mtimeMs))
if (newestUnder(join(root, 'src')) > built) {
  console.error('package: src/ is newer than the build. Run `pnpm build` first.')
  process.exit(1)
}

const dist = join(root, 'dist')
rmSync(dist, { recursive: true, force: true })
const pluginDir = join(dist, manifest.id)
mkdirSync(pluginDir, { recursive: true })
for (const file of FILES) copyFileSync(join(root, file), join(pluginDir, file))

const zipName = `${manifest.id}-${manifest.version}.zip`
execFileSync('zip', ['-qr', zipName, manifest.id], { cwd: dist })

console.log(`package: dist/${manifest.id}/ and dist/${zipName}`)
for (const file of FILES) {
  console.log(`  ${file}  ${(statSync(join(pluginDir, file)).size / 1024).toFixed(1)} kB`)
}
