import { extensionOf, fold, type LibraryDoc } from './libraryDoc'

/**
 * How the library's documents are filed: a category — plan, planning, report —, the lot
 * or package they belong to, who issued them, and tags of the reader's own.
 *
 * The categories are the reader's list, one a line, each followed by the words a file's
 * name is recognised by: « Compte rendu : cr, pv, réunion ». A document poured in with no
 * category given takes the one its name answers best, which is how two hundred files are
 * sorted without two hundred choices. The tags are Obsidian's own, so the vault's tag
 * pane and search find them too.
 */

export interface Category {
  name: string
  /** Folded words or phrases a file name answers to. */
  keywords: string[]
}

export interface Classification {
  category: string
  lot: string
  issuer: string
  tags: string[]
}

/** The reader's list, read: « Nom : mot, mot » a line; a line with no colon is a name alone. */
export function parseCategories(text: string): Category[] {
  const seen = new Set<string>()
  const out: Category[] = []
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const colon = line.indexOf(':')
    const name = (colon >= 0 ? line.slice(0, colon) : line).trim()
    if (!name || seen.has(fold(name))) continue
    seen.add(fold(name))
    const keywords =
      colon >= 0
        ? line
            .slice(colon + 1)
            .split(',')
            .map((word) => fold(word).trim())
            .filter(Boolean)
        : []
    out.push({ name, keywords })
  }
  return out
}

/** A name as the words it is made of, folded: « CR_réunion-12.pdf » is « cr reunion 12 pdf ». */
function nameWords(name: string): string {
  return ` ${fold(name)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .join(' ')} `
}

/**
 * The category a file's name answers best: the one with the most of its words in it —
 * whole words, so « cr » is found in « CR 12 » and not in « écran » — the list's order
 * deciding between equals. Empty when none answers.
 */
export function guessCategory(name: string, categories: Category[]): string {
  const words = nameWords(`${name} ${extensionOf(name)}`)
  let best = ''
  let bestScore = 0
  for (const category of categories) {
    const score = [fold(category.name), ...category.keywords].filter((keyword) =>
      words.includes(` ${nameWords(keyword).trim()} `)
    ).length
    if (score > bestScore) {
      best = category.name
      bestScore = score
    }
  }
  return best
}

/**
 * Tags as Obsidian takes them: no hash, no spaces — a space becomes a dash —, nothing but
 * letters, digits, dashes, underscores and slashes, once each.
 */
export function cleanTags(raw: string | string[]): string[] {
  const list = Array.isArray(raw) ? raw : raw.split(/[,;\n]/)
  const out: string[] = []
  for (const entry of list) {
    const tag = entry
      .trim()
      .replace(/^#+/, '')
      .replace(/\s+/g, '-')
      .replace(/[^\p{L}\p{N}_/-]/gu, '')
    // A tag of digits alone is not one to Obsidian.
    if (!tag || /^\d+$/.test(tag) || out.some((each) => each.toLowerCase() === tag.toLowerCase())) continue
    out.push(tag)
  }
  return out
}

/** The values a field holds across the library, the most used first: what to suggest. */
export function knownValues(docs: LibraryDoc[], field: 'category' | 'lot' | 'issuer' | 'tags'): string[] {
  const counts = new Map<string, number>()
  for (const doc of docs) {
    const values = field === 'tags' ? doc.tags : [doc[field]]
    for (const value of values) if (value) counts.set(value, (counts.get(value) ?? 0) + 1)
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([value]) => value)
}

/**
 * The lots documents of these projects can be filed under: the projects' own, as their
 * plans have them, then those the library already files their documents under.
 */
export function projectLots(
  tickets: { title: string; type: string; projectPath: string | null; archived: boolean }[],
  docs: LibraryDoc[],
  projects: string[]
): string[] {
  const wanted = new Set(projects)
  const lots = tickets
    .filter(
      (ticket) => !ticket.archived && ticket.type === 'phase' && ticket.projectPath && wanted.has(ticket.projectPath)
    )
    .map((ticket) => ticket.title)
  const filed = docs.filter((doc) => doc.projects.some((path) => wanted.has(path)))
  return [...lots, ...knownValues(filed, 'lot')]
}

/**
 * The reader's list of categories with one more at its end — the list shipped taken as
 * theirs when they have none —, or as it was when it has that one already.
 */
export function withCategory(list: string, shipped: string, name: string): string {
  const category = name.trim()
  const current = list.trim() || shipped
  if (!category || parseCategories(current).some((known) => fold(known.name) === fold(category))) return list
  return `${current}\n${category}`
}

/**
 * A classification laid over what a document already has: the fields given replace, the
 * empty ones leave alone, and tags are added to rather than replaced — so ticking forty
 * documents and giving them a lot does not wipe their categories.
 */
export function mergeClassification(current: Classification, given: Partial<Classification>): Classification {
  return {
    category: given.category?.trim() || current.category,
    lot: given.lot?.trim() || current.lot,
    issuer: given.issuer?.trim() || current.issuer,
    tags: cleanTags([...current.tags, ...(given.tags ?? [])])
  }
}
