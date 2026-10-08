import { fold } from '../store/library/libraryDoc'

/**
 * A list of choices under a text field: all of them as soon as the field is clicked —
 * whatever it holds —, then only those matching what is typed. Arrows move through them,
 * Enter or a click takes one; anything else typed stays as typed.
 *
 * Attached before the field's own key handlers, so Enter on a choice takes it first.
 *
 * Unlike the browser's own `datalist`, which only offers what matches the field's
 * current value and so, on a filled field, nothing but that value.
 */
export function attachComboList(
  input: HTMLInputElement,
  choices: () => string[],
  onPick: (value: string) => void
): void {
  const host = input.parentElement ?? input
  host.addClass('pm-combo-host')
  let list: HTMLElement | null = null
  let shown: string[] = []
  let active = -1
  // Typed since it was opened: until then, everything is offered.
  let typed = false

  const close = (): void => {
    list?.remove()
    list = null
    active = -1
  }
  const pick = (value: string): void => {
    input.value = value
    close()
    onPick(value)
  }
  const draw = (): void => {
    const query = typed ? fold(input.value.trim()) : ''
    shown = choices().filter((choice) => !query || fold(choice).includes(query))
    if (!shown.length) {
      close()
      return
    }
    if (!list) list = host.createDiv('pm-combo-list')
    list.empty()
    if (active >= shown.length) active = shown.length - 1
    shown.forEach((choice, at) => {
      const item = list?.createDiv({ cls: 'pm-combo-item', text: choice })
      if (!item) return
      if (at === active) item.addClass('is-active')
      if (choice === input.value.trim()) item.addClass('is-current')
      // Taken before the field loses its focus.
      item.addEventListener('mousedown', (event) => {
        event.preventDefault()
        pick(choice)
      })
    })
    list.querySelector('.is-active, .is-current')?.scrollIntoView({ block: 'nearest' })
  }

  input.setAttr('autocomplete', 'off')
  input.addEventListener('focus', () => {
    typed = false
    active = -1
    draw()
  })
  input.addEventListener('click', () => {
    if (!list) draw()
  })
  input.addEventListener('input', () => {
    typed = true
    active = -1
    draw()
  })
  input.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (!list) draw()
      if (!shown.length) return
      const step = event.key === 'ArrowDown' ? 1 : -1
      active = (active + step + shown.length) % shown.length
      draw()
    } else if (event.key === 'Enter' && list && active >= 0) {
      // Taken here, not by what the field does on Enter.
      event.preventDefault()
      event.stopImmediatePropagation()
      pick(shown[active])
    } else if (event.key === 'Escape' && list) {
      event.preventDefault()
      event.stopImmediatePropagation()
      close()
    }
  })
  input.addEventListener('blur', close)
}
