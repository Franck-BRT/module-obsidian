import { normalizePath, TFile, type App } from 'obsidian'
import { displayName } from '../utils'
import { fold } from './library/libraryDoc'
import { createPersonNote, personNotes } from './people'
import { stringList } from './YamlHydrator'

/**
 * The people and companies a project deals with, each a note in the people folder — the
 * notes assignees already link to —, with what a project needs to reach them in its
 * properties: what they are, the company a person works for, their role, their mail and
 * phone, the lots they hold. A note the reader writes by hand is read the same, in either
 * language: `email` or `courriel`, `phone` or `téléphone`, `company` or `entreprise`.
 */

export type ContactKind = 'person' | 'company'

export interface ContactFields {
  kind: ContactKind
  /** The company a person works for, as a name. */
  company: string
  role: string
  email: string
  phone: string
  lots: string[]
}

export interface Contact extends ContactFields {
  path: string
  /** The note's name: the name the contact goes by. */
  name: string
  aliases: string[]
}

/** The folder contacts live in: the people folder, `People` when none is set. */
export function contactFolder(peopleFolder: string): string {
  return normalizePath(peopleFolder.trim() || 'People')
}

function text(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim()
    if (typeof value === 'number' && Number.isFinite(value)) return String(value)
    if (Array.isArray(value)) {
      const first: unknown = value.find((one) => typeof one === 'string' && one.trim())
      if (typeof first === 'string') return first.trim()
    }
  }
  return ''
}

function list(...values: unknown[]): string[] {
  for (const value of values) {
    if (Array.isArray(value)) return stringList(value).map((one) => one.trim())
    if (typeof value === 'string' && value.trim()) {
      return value
        .split(/[,;]/)
        .map((one) => one.trim())
        .filter(Boolean)
    }
  }
  return []
}

/** A contact as its note's properties say. */
export function readContact(path: string, name: string, fm: Record<string, unknown> | undefined): Contact {
  const data = fm ?? {}
  const kind = fold(text(data.kind, data.type, data.nature))
  return {
    path,
    name,
    kind: /^(company|entreprise|societe|organisation|organization|org)$/.test(kind) ? 'company' : 'person',
    company: displayName(text(data.company, data.entreprise, data.societe, data['société'], data.organisation)),
    role: text(data.role, data['rôle'], data.fonction, data.title),
    email: text(data.email, data.mail, data.courriel, data['e-mail']),
    phone: text(data.phone, data.telephone, data['téléphone'], data.tel, data.mobile),
    lots: list(data.lots, data.lot),
    aliases: list(data.aliases, data.alias)
  }
}

/** Every contact of the people folder, by name. */
export function readContacts(app: App, peopleFolder: string): Contact[] {
  return personNotes(app, contactFolder(peopleFolder))
    .map((file) =>
      readContact(
        file.path,
        file.basename,
        app.metadataCache.getFileCache(file)?.frontmatter as Record<string, unknown>
      )
    )
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** A name as it is compared: a link's name, accents, case and spacing aside. */
export function contactKey(raw: string): string {
  return fold(displayName(raw)).replace(/\s+/g, ' ').trim()
}

/** The contacts, looked up by the names the register and the tickets write. */
export class ContactBook {
  private byKey = new Map<string, Contact>()

  constructor(readonly contacts: Contact[]) {
    for (const contact of contacts) {
      for (const key of [contact.name, ...contact.aliases].map(contactKey)) {
        if (key && !this.byKey.has(key)) this.byKey.set(key, contact)
      }
    }
  }

  /** The contact a name stands for — a link, a bare name or an alias —; null when none. */
  find(raw: string): Contact | null {
    return this.byKey.get(contactKey(raw)) ?? null
  }

  companies(): Contact[] {
    return this.contacts.filter((contact) => contact.kind === 'company')
  }

  /** The people working for a company, those with a mail first. */
  members(company: string): Contact[] {
    const key = contactKey(company)
    return this.contacts
      .filter((contact) => contact.kind === 'person' && contact.company && contactKey(contact.company) === key)
      .sort((a, b) => Number(!!b.email) - Number(!!a.email) || a.name.localeCompare(b.name))
  }

  /**
   * Where to write to whoever a name stands for: a person's own mail; a company's, or else
   * those of the people working for it. Empty when no contact or no mail is known.
   */
  emailsFor(raw: string): string[] {
    const contact = this.find(raw)
    if (!contact) return []
    if (contact.email) return [contact.email]
    if (contact.kind !== 'company') return []
    return this.members(contact.name)
      .map((member) => member.email)
      .filter(Boolean)
  }

  /** The person to address for a name: the person itself, or the first of a company with a mail. */
  personFor(raw: string): Contact | null {
    const contact = this.find(raw)
    if (!contact) return null
    if (contact.kind === 'person') return contact
    return this.members(contact.name)[0] ?? null
  }

  /** The names known, companies first, for a field to suggest. */
  names(): string[] {
    return [...this.companies(), ...this.contacts.filter((contact) => contact.kind === 'person')].map((c) => c.name)
  }
}

/** The properties a contact is written with, the empty ones left out. */
export function contactProperties(fields: ContactFields, companyLink: string): Record<string, unknown> {
  const out: Record<string, unknown> = { kind: fields.kind }
  if (fields.kind === 'person' && fields.company.trim()) out.company = companyLink || fields.company.trim()
  if (fields.role.trim()) out.role = fields.role.trim()
  if (fields.email.trim()) out.email = fields.email.trim()
  if (fields.phone.trim()) out.phone = fields.phone.trim()
  const lots = fields.lots.map((lot) => lot.trim()).filter(Boolean)
  if (lots.length) out.lots = lots
  return out
}

/** Every key a contact's properties may be read from, cleared before it is written again. */
const CONTACT_KEYS = [
  'kind',
  'type',
  'nature',
  'company',
  'entreprise',
  'societe',
  'société',
  'organisation',
  'role',
  'rôle',
  'fonction',
  'email',
  'mail',
  'courriel',
  'e-mail',
  'phone',
  'telephone',
  'téléphone',
  'tel',
  'mobile',
  'lots',
  'lot'
]

/** A name a note can be given: what a file name cannot hold, taken out. */
export function contactFileName(name: string): string {
  return name
    .replace(/[\\/:*?"<>|#^[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Writes a contact: its note made when it is new, renamed when its name changed — the
 * links to it following —, and its properties set, the rest of the note left as it is.
 * The note's path comes back.
 */
export async function saveContact(
  app: App,
  peopleFolder: string,
  previous: string | null,
  name: string,
  fields: ContactFields
): Promise<string> {
  const clean = contactFileName(name)
  if (!clean) throw new Error('empty name')
  const folder = contactFolder(peopleFolder)
  let file: TFile | null = null
  if (previous) {
    const found = app.vault.getAbstractFileByPath(previous)
    if (found instanceof TFile) file = found
  }
  if (!file) file = await createPersonNote(app, folder, clean)
  else if (file.basename !== clean) {
    const parent = file.parent?.path ?? folder
    const target = normalizePath(`${parent === '/' ? '' : `${parent}/`}${clean}.md`)
    if (app.vault.getAbstractFileByPath(target)) throw new Error('exists')
    await app.fileManager.renameFile(file, target)
  }
  const company = fields.company.trim()
  const companyFile = company ? app.metadataCache.getFirstLinkpathDest(contactFileName(company), file.path) : null
  const properties = contactProperties(fields, companyFile ? `[[${companyFile.basename}]]` : '')
  await app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
    for (const key of CONTACT_KEYS) Reflect.deleteProperty(fm, key)
    Object.assign(fm, properties)
  })
  return file.path
}
