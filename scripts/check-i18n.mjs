// Every catalogue key must be read by something. A key nothing asks for is usually a
// string that was translated but never swapped in at its call site — which is exactly
// how a translation ends up looking complete while the interface is still English.
//
// It lives here rather than in the test suite because it reads the source tree, and
// tsc has no node types in this project.
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function sourceFiles(dir) {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...sourceFiles(full))
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') && !full.includes('i18n')) out.push(full)
  }
  return out
}

const catalog = readFileSync(join(root, 'src/i18n/en.ts'), 'utf8')
const keys = [...catalog.matchAll(/^ {2}'([^']+)':/gm)].map((m) => m[1])

const used = new Set()
for (const file of sourceFiles(join(root, 'src'))) {
  const src = readFileSync(file, 'utf8')
  // `searchAliases` reads the catalogue too, it just splits what it finds.
  for (const m of src.matchAll(/\b(?:t|searchAliases)\('([^']+)'/g)) used.add(m[1])
  // Keys built at the call site, as in t(`weekday.${day}`).
  for (const m of src.matchAll(/\bt\(`([a-zA-Z.]+)\.\$\{/g)) {
    for (const key of keys) if (key.startsWith(m[1] + '.')) used.add(key)
  }
}

const unused = keys.filter((key) => !used.has(key))
if (unused.length) {
  console.error(`check:i18n: ${unused.length} catalogue key(s) nothing uses:`)
  for (const key of unused) console.error(`  ${key}`)
  process.exit(1)
}
console.log(`check:i18n: ${keys.length} keys, all in use.`)
