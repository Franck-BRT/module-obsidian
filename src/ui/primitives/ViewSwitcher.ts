import { ExtraButtonComponent } from 'obsidian'
import { explain } from '../explain'

export interface ViewSwitcherOption<T extends string> {
  id: T
  icon: string
  label: string
  /** What the view shows, said when the button is hovered a moment. */
  help?: string
}

export interface ViewSwitcherProps<T extends string> {
  options: ViewSwitcherOption<T>[]
  active: T
  onChange: (id: T) => void
}

export class ViewSwitcher<T extends string> {
  el: HTMLElement

  constructor(parentEl: HTMLElement, props: ViewSwitcherProps<T>) {
    this.el = parentEl.createDiv('pm-view-switcher')
    for (const opt of props.options) {
      const btn = new ExtraButtonComponent(this.el).setIcon(opt.icon)
      explain(btn.extraSettingsEl, opt.label, opt.help ?? '')
      btn.extraSettingsEl.addClass('pm-view-btn')
      if (opt.id === props.active) btn.extraSettingsEl.addClass('pm-view-btn--active')
      btn.onClick(() => {
        this.el.querySelectorAll('.pm-view-btn').forEach((b) => b.removeClass('pm-view-btn--active'))
        btn.extraSettingsEl.addClass('pm-view-btn--active')
        props.onChange(opt.id)
      })
    }
  }
}
