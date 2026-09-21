import { setIcon } from 'obsidian'
import { t } from '../../i18n'

/**
 * A rating as five shapes.
 *
 * Lit stars are filled and unlit ones are outlines, so the two differ in shape and not
 * only in hue — and the whole row carries the rating in words for anybody reading it
 * through a screen reader, to whom five identical spans say nothing at all.
 */
export function renderStars(parent: HTMLElement, stars: number, cls = ''): HTMLElement {
  const row = parent.createDiv({
    cls: `pm-req-stars ${cls}`.trim(),
    attr: { 'aria-label': t('req.ratingStars', { stars }) }
  })
  for (let index = 0; index < 5; index++) {
    const star = row.createSpan({ cls: index < stars ? 'pm-req-star pm-req-star--on' : 'pm-req-star' })
    setIcon(star, 'star')
  }
  return row
}
