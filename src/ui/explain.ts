/**
 * A button explained: hovered — or reached with the keyboard — for a moment, it says what
 * it is called and, in a line or two, what it does. Shown after a delay, so a click made
 * at once is never covered; gone when the pointer leaves, on a click, on Escape or when
 * the page scrolls. One bubble for the whole window, drawn in the theme's colours.
 *
 * The element's own label stays for screen readers, but out of Obsidian's tooltip, which
 * would show it a second time over this one.
 */

export interface ExplainSettings {
  enabled: boolean
  /** Milliseconds before it shows. */
  delay: number
}

let settings: ExplainSettings = { enabled: true, delay: 1000 }

/** Whether the bubbles show, and after how long. */
export function configureExplain(next: ExplainSettings): void {
  settings = { enabled: next.enabled, delay: Math.max(0, next.delay) }
  if (!settings.enabled) hide()
}

interface Tip {
  title: string
  help: string
}

const tips = new WeakMap<HTMLElement, Tip>()
let bubble: HTMLElement | null = null
let owner: HTMLElement | null = null
let timer: number | null = null
let watch: number | null = null

function cancel(): void {
  if (timer !== null) window.clearTimeout(timer)
  timer = null
}

function hide(): void {
  cancel()
  if (watch !== null) window.clearInterval(watch)
  watch = null
  bubble?.remove()
  bubble = null
  owner = null
}

/** Where the bubble goes: under the element, centred on it, kept on screen; above when there is no room below. */
export function placeBubble(
  target: { left: number; right: number; top: number; bottom: number },
  size: { width: number; height: number },
  viewport: { width: number; height: number },
  gap = 8
): { left: number; top: number } {
  const centre = (target.left + target.right) / 2
  const left = Math.min(Math.max(gap, centre - size.width / 2), Math.max(gap, viewport.width - size.width - gap))
  const below = target.bottom + gap
  const top = below + size.height + gap <= viewport.height ? below : Math.max(gap, target.top - gap - size.height)
  return { left: Math.round(left), top: Math.round(top) }
}

function show(el: HTMLElement): void {
  const tip = tips.get(el)
  if (!tip || !el.isConnected) return
  hide()
  const doc = el.ownerDocument
  const win = doc.defaultView ?? window
  owner = el
  bubble = doc.body.createDiv({ cls: 'pm-tip', attr: { role: 'tooltip' } })
  bubble.createDiv({ cls: 'pm-tip-title', text: tip.title })
  if (tip.help) bubble.createDiv({ cls: 'pm-tip-help', text: tip.help })
  const rect = el.getBoundingClientRect()
  const at = placeBubble(
    rect,
    { width: bubble.offsetWidth, height: bubble.offsetHeight },
    { width: win.innerWidth, height: win.innerHeight }
  )
  bubble.setCssStyles({ left: `${at.left}px`, top: `${at.top}px` })
  bubble.addClass('is-shown')
  // The element redrawn away under it: the bubble goes with it.
  watch = window.setInterval(() => {
    if (!owner?.isConnected) hide()
  }, 400)
}

function schedule(el: HTMLElement): void {
  if (!settings.enabled) return
  cancel()
  timer = window.setTimeout(() => {
    timer = null
    show(el)
  }, settings.delay)
}

let listening = false

function listenOnce(): void {
  if (listening) return
  listening = true
  window.addEventListener('scroll', hide, true)
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') hide()
  })
}

/**
 * Gives an element its explanation: its name, and what it does. Called again, the
 * explanation is replaced.
 */
export function explain(el: HTMLElement, title: string, help = ''): void {
  if (!title) return
  listenOnce()
  const fresh = !tips.has(el)
  tips.set(el, { title, help })
  // Out of Obsidian's tooltip, kept for screen readers.
  el.removeAttribute('aria-label')
  el.removeAttribute('title')
  let spoken = el.querySelector<HTMLElement>(':scope > .pm-sr-only')
  if (!el.textContent?.trim() || spoken) {
    spoken ??= el.createSpan({ cls: 'pm-sr-only' })
    spoken.setText(title)
  }
  if (help) el.setAttribute('aria-description', help)
  else el.removeAttribute('aria-description')
  if (!fresh) return
  el.addEventListener('mouseenter', () => schedule(el))
  el.addEventListener('mouseleave', hide)
  el.addEventListener('focus', () => schedule(el))
  el.addEventListener('blur', hide)
  el.addEventListener('mousedown', hide)
}
