// A browser stand-in for the Obsidian API: enough of it for the plugin's views and
// modals to render in Chromium, to be photographed. Icons are lucide's own SVGs.
import { parse, stringify } from 'yaml'

declare const ICONS: Record<string, string>

type Info = string | { cls?: string | string[]; text?: string | DocumentFragment; attr?: Record<string, string | number | boolean | null>; title?: string; href?: string; type?: string; value?: string; placeholder?: string; parent?: Node; prepend?: boolean }

function apply(el: HTMLElement, o?: Info): void {
  if (!o) return
  if (typeof o === 'string') {
    el.className = o
    return
  }
  if (o.cls) el.className = Array.isArray(o.cls) ? o.cls.join(' ') : o.cls
  if (o.text !== undefined) {
    if (typeof o.text === 'string') el.textContent = o.text
    else el.appendChild(o.text)
  }
  if (o.attr) for (const [k, v] of Object.entries(o.attr)) if (v !== null && v !== false) el.setAttribute(k, String(v))
  if (o.title) el.title = o.title
  if (o.href) el.setAttribute('href', o.href)
  if (o.type) el.setAttribute('type', o.type)
  if (o.value !== undefined) (el as HTMLInputElement).value = o.value
  if (o.placeholder) el.setAttribute('placeholder', o.placeholder)
}

const P = Node.prototype as any
P.createEl = function (tag: string, o?: Info, cb?: (el: HTMLElement) => void) {
  const el = document.createElement(tag)
  apply(el, o)
  if (typeof o === 'object' && o?.prepend) this.insertBefore(el, this.firstChild)
  else this.appendChild(el)
  cb?.(el)
  return el
}
P.createDiv = function (o?: Info, cb?: (el: HTMLElement) => void) {
  return this.createEl('div', o, cb)
}
P.createSpan = function (o?: Info, cb?: (el: HTMLElement) => void) {
  return this.createEl('span', o, cb)
}
P.createSvg = function (tag: string, o?: any) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag)
  if (o?.cls) el.setAttribute('class', o.cls)
  if (o?.attr) for (const [k, v] of Object.entries(o.attr)) el.setAttribute(k, String(v))
  this.appendChild(el)
  return el
}
P.empty = function () {
  while (this.firstChild) this.removeChild(this.firstChild)
}
P.detach = function () {
  this.parentNode?.removeChild(this)
}
P.setText = function (t: string) {
  this.textContent = t
}
P.appendText = function (t: string) {
  this.appendChild(document.createTextNode(t))
}
const E = Element.prototype as any
E.addClass = function (...c: string[]) {
  this.classList.add(...c.flatMap((x) => x.split(' ').filter(Boolean)))
}
E.addClasses = function (c: string[]) {
  this.addClass(...c)
}
E.removeClass = function (...c: string[]) {
  this.classList.remove(...c)
}
E.toggleClass = function (c: string, on: boolean) {
  this.classList.toggle(c, on)
}
E.hasClass = function (c: string) {
  return this.classList.contains(c)
}
E.setAttr = function (k: string, v: any) {
  if (v === null || v === undefined || v === false) this.removeAttribute(k)
  else this.setAttribute(k, String(v))
}
E.setAttrs = function (o: Record<string, any>) {
  for (const [k, v] of Object.entries(o)) this.setAttr(k, v)
}
E.getAttr = function (k: string) {
  return this.getAttribute(k)
}
E.setCssProps = function (o: Record<string, string>) {
  for (const [k, v] of Object.entries(o)) this.style.setProperty(k, v)
}
E.setCssStyles = function (o: Record<string, string>) {
  Object.assign(this.style, o)
}
E.show = function () {
  this.style.display = ''
}
E.hide = function () {
  this.style.display = 'none'
}
E.toggle = function (show: boolean) {
  this.style.display = show ? '' : 'none'
}
E.isShown = function () {
  return this.style.display !== 'none'
}
E.find = function (s: string) {
  return this.querySelector(s)
}
E.findAll = function (s: string) {
  return Array.from(this.querySelectorAll(s))
}
E.onClickEvent = function (cb: (e: MouseEvent) => void) {
  this.addEventListener('click', cb)
}
E.instanceOf = function (k: any) {
  return this instanceof k
}
const g = globalThis as any
g.createDiv = (o?: Info) => document.createDocumentFragment().createDiv(o)
g.createEl = (tag: string, o?: Info) => document.createDocumentFragment().createEl(tag, o)
g.createSpan = (o?: Info) => document.createDocumentFragment().createSpan(o)
g.createFragment = (cb?: (f: DocumentFragment) => void) => {
  const f = document.createDocumentFragment()
  cb?.(f)
  return f
}
g.activeDocument = document
g.activeWindow = window
;(Array.prototype as any).first = function () {
  return this[0]
}
;(Array.prototype as any).last = function () {
  return this[this.length - 1]
}
;(Array.prototype as any).contains = function (x: unknown) {
  return this.includes(x)
}
;(Array.prototype as any).remove = function (x: unknown) {
  const i = this.indexOf(x)
  if (i >= 0) this.splice(i, 1)
}
;(String.prototype as any).contains = function (x: string) {
  return this.includes(x)
}

export const parseYaml = (raw: string): unknown => parse(raw)
export const stringifyYaml = (obj: unknown): string => stringify(obj)
export const apiVersion = '1.13.0'
export const Platform = { isMobile: false, isDesktop: true, isMacOS: false, isPhone: false }

export function setIcon(el: HTMLElement, name: string): void {
  el.empty()
  const svg = ICONS[name]
  if (!svg) {
    ;(globalThis as any).MISSING_ICONS ??= new Set()
    ;(globalThis as any).MISSING_ICONS.add(name)
    el.createSpan({ text: '?', attr: { style: 'color:red;font-weight:bold' } })
    return
  }
  el.insertAdjacentHTML('beforeend', svg.replace('<svg', '<svg class="svg-icon lucide-' + name + '"'))
}
export function getIconIds(): string[] {
  return Object.keys(ICONS)
}
export function setTooltip(el: HTMLElement, text: string): void {
  el.setAttribute('aria-label', text)
}
export function getLanguage(): string {
  return (globalThis as any).LANG ?? 'fr'
}
export function normalizePath(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\/+/, '').replace(/\/+$/, '')
}
export function parseLinktext(linktext: string): { path: string; subpath: string } {
  const hash = linktext.indexOf('#')
  return hash < 0 ? { path: linktext, subpath: '' } : { path: linktext.slice(0, hash), subpath: linktext.slice(hash) }
}
export function debounce<T extends (...a: any[]) => any>(fn: T): T {
  return fn
}
export function prepareFuzzySearch(q: string) {
  return (text: string) => (text.toLowerCase().includes(q.toLowerCase()) ? { score: 1, matches: [] } : null)
}
export async function requestUrl(): Promise<never> {
  throw new Error('offline')
}
export async function loadPdfJs(): Promise<never> {
  throw new Error('no pdf.js')
}

export class Notice {
  noticeEl: HTMLElement
  constructor(message?: string | DocumentFragment, _duration?: number) {
    let box = document.querySelector('.notice-container') as HTMLElement | null
    if (!box) box = document.body.createDiv('notice-container')
    this.noticeEl = box.createDiv('notice')
    if (message !== undefined) this.setMessage(message)
  }
  setMessage(message: string | DocumentFragment): this {
    this.noticeEl.empty()
    if (typeof message === 'string') this.noticeEl.setText(message)
    else this.noticeEl.appendChild(message)
    return this
  }
  hide(): void {
    this.noticeEl.remove()
  }
}

export class TAbstractFile {
  path = ''
  name = ''
  parent: TFolder | null = null
  vault: any
}
export class TFile extends TAbstractFile {
  basename = ''
  extension = ''
  stat = { ctime: 0, mtime: 0, size: 0 }
}
export class TFolder extends TAbstractFile {
  children: TAbstractFile[] = []
  isRoot(): boolean {
    return this.parent === null
  }
}

export class Component {
  load(): void {}
  onload(): void {}
  unload(): void {}
  onunload(): void {}
  addChild<T>(c: T): T {
    return c
  }
  register(): void {}
  registerEvent(): void {}
  registerDomEvent(el: EventTarget, type: string, cb: any): void {
    el.addEventListener(type, cb)
  }
  registerInterval(id: number): number {
    return id
  }
}
export class MarkdownRenderChild extends Component {
  constructor(public containerEl: HTMLElement) {
    super()
  }
}
export const MarkdownRenderer = {
  async render(_app: unknown, md: string, el: HTMLElement): Promise<void> {
    el.createDiv({ text: md })
  }
}
export class Scope {
  register(): object {
    return {}
  }
  unregister(): void {}
}
export const Keymap = { isModEvent: () => false }

export class Modal {
  app: any
  containerEl: HTMLElement
  modalEl: HTMLElement
  titleEl: HTMLElement
  contentEl: HTMLElement
  scope = new Scope()
  constructor(app: unknown) {
    this.app = app
    this.containerEl = document.createElement('div')
    this.containerEl.className = 'modal-container mod-dim'
    this.containerEl.createDiv('modal-bg')
    this.modalEl = this.containerEl.createDiv('modal')
    this.modalEl.createDiv('modal-close-button')
    const header = this.modalEl.createDiv('modal-header')
    this.titleEl = header.createDiv('modal-title')
    this.contentEl = this.modalEl.createDiv('modal-content')
  }
  setTitle(t: string): this {
    this.titleEl.setText(t)
    return this
  }
  setContent(c: string | DocumentFragment): this {
    this.contentEl.empty()
    if (typeof c === 'string') this.contentEl.setText(c)
    else this.contentEl.appendChild(c)
    return this
  }
  open(): void {
    document.body.appendChild(this.containerEl)
    ;(this as any).onOpen?.()
  }
  close(): void {
    ;(this as any).onClose?.()
    this.containerEl.remove()
  }
}
export class SuggestModal<T> extends Modal {
  inputEl = document.createElement('input')
  setPlaceholder(): void {}
  getSuggestions(): T[] {
    return []
  }
}

export class Menu {
  items: { title: string }[] = []
  addItem(cb: (item: any) => void): this {
    const item: any = {}
    for (const m of ['setTitle', 'setIcon', 'onClick', 'setChecked', 'setDisabled', 'setSection', 'setWarning', 'setSubmenu']) {
      item[m] = (v: unknown) => {
        if (m === 'setTitle') this.items.push({ title: String(v) })
        return item
      }
    }
    cb(item)
    return this
  }
  addSeparator(): this {
    return this
  }
  showAtMouseEvent(): this {
    return this
  }
  showAtPosition(): this {
    return this
  }
  onHide(): this {
    return this
  }
}

export class ButtonComponent {
  buttonEl: HTMLButtonElement
  constructor(parent: HTMLElement) {
    this.buttonEl = parent.createEl('button') as HTMLButtonElement
  }
  setButtonText(t: string): this {
    this.buttonEl.setText(t)
    return this
  }
  setIcon(name: string): this {
    setIcon(this.buttonEl, name)
    return this
  }
  setTooltip(t: string): this {
    this.buttonEl.setAttribute('aria-label', t)
    return this
  }
  setCta(): this {
    this.buttonEl.addClass('mod-cta')
    return this
  }
  setWarning(): this {
    this.buttonEl.addClass('mod-warning')
    return this
  }
  setClass(c: string): this {
    this.buttonEl.addClass(c)
    return this
  }
  setDisabled(d: boolean): this {
    this.buttonEl.disabled = d
    return this
  }
  onClick(cb: (e: MouseEvent) => void): this {
    this.buttonEl.addEventListener('click', cb)
    return this
  }
}
export class ExtraButtonComponent {
  extraSettingsEl: HTMLElement
  constructor(parent: HTMLElement) {
    this.extraSettingsEl = parent.createDiv('clickable-icon extra-setting-button')
  }
  setIcon(n: string): this {
    setIcon(this.extraSettingsEl, n)
    return this
  }
  setTooltip(): this {
    return this
  }
  onClick(cb: () => void): this {
    this.extraSettingsEl.addEventListener('click', cb)
    return this
  }
}
export class Setting {
  settingEl: HTMLElement
  infoEl: HTMLElement
  nameEl: HTMLElement
  descEl: HTMLElement
  controlEl: HTMLElement
  constructor(parent: HTMLElement) {
    this.settingEl = parent.createDiv('setting-item')
    this.infoEl = this.settingEl.createDiv('setting-item-info')
    this.nameEl = this.infoEl.createDiv('setting-item-name')
    this.descEl = this.infoEl.createDiv('setting-item-description')
    this.controlEl = this.settingEl.createDiv('setting-item-control')
  }
  setName(n: string): this {
    this.nameEl.setText(n)
    return this
  }
  setDesc(d: string): this {
    this.descEl.setText(d)
    return this
  }
  setHeading(): this {
    this.settingEl.addClass('setting-item-heading')
    return this
  }
  addButton(cb: (b: ButtonComponent) => void): this {
    cb(new ButtonComponent(this.controlEl))
    return this
  }
  private control(tag: string, type?: string): any {
    const el = this.controlEl.createEl(tag, type ? { attr: { type } } : undefined) as any
    const c: any = {
      inputEl: el,
      selectEl: el,
      toggleEl: el,
      setValue: (v: unknown) => {
        if (type === 'checkbox') el.checked = !!v
        else el.value = v
        return c
      },
      getValue: () => (type === 'checkbox' ? el.checked : el.value),
      setPlaceholder: (p: string) => {
        el.placeholder = p
        return c
      },
      addOption: (v: string, label: string) => {
        el.createEl('option', { value: v, text: label })
        return c
      },
      addOptions: (o: Record<string, string>) => {
        for (const [v, label] of Object.entries(o)) el.createEl('option', { value: v, text: label })
        return c
      },
      onChange: (cb: (v: unknown) => void) => {
        el.addEventListener('change', () => cb(c.getValue()))
        return c
      },
      setDisabled: (d: boolean) => {
        el.disabled = d
        return c
      }
    }
    return c
  }
  addText(cb: (c: any) => void): this {
    cb(this.control('input', 'text'))
    return this
  }
  addSearch(cb: (c: any) => void): this {
    cb(this.control('input', 'search'))
    return this
  }
  addDropdown(cb: (c: any) => void): this {
    cb(this.control('select'))
    return this
  }
  addToggle(cb: (c: any) => void): this {
    cb(this.control('input', 'checkbox'))
    return this
  }
  addTextArea(cb: (c: any) => void): this {
    cb(this.control('textarea'))
    return this
  }
  setClass(c: string): this {
    this.settingEl.addClass(c)
    return this
  }
  setDisabled(): this {
    return this
  }
}
export class ItemView extends Component {}
export class FileView extends ItemView {}
export class MarkdownView extends FileView {}
export class WorkspaceLeaf {}
export class Plugin extends Component {}
export class PluginSettingTab {}
export class App {}
