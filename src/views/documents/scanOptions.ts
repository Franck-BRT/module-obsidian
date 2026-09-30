import { ButtonComponent, Modal, Setting, type App } from 'obsidian'
import type { OcrSettings } from '../../types'
import { t } from '../../i18n'

/**
 * The steps of a reading by the model that sees, each one the reader may leave out: they
 * make it whole, and they each cost requests. Offered when a reading is launched, kept as
 * the next one's choice, and found again in the settings, where the chat's readings take
 * them from.
 */

type Step = keyof OcrSettings

export const OCR_STEPS: Step[] = ['allPages', 'carryOn', 'retry', 'check', 'layerText', 'furniture', 'pageMarks']

/** The toggles, drawn under `parent`; `changed` is told each change, the choices in hand. */
export function renderOcrOptions(parent: HTMLElement, chosen: OcrSettings, changed: () => void = () => {}): void {
  const rows = new Map<Step, Setting>()
  // Adding the PDF's text follows its check: without it, there is nothing to add.
  const follow = (): void => {
    rows.get('layerText')?.settingEl.toggleClass('is-disabled', !chosen.check)
  }
  for (const step of OCR_STEPS) {
    const row = new Setting(parent).setName(stepName(step)).setDesc(stepDesc(step))
    row.addToggle((toggle) =>
      toggle.setValue(chosen[step]).onChange((value) => {
        chosen[step] = value
        follow()
        changed()
      })
    )
    rows.set(step, row)
  }
  follow()
}

export function stepName(step: Step): string {
  switch (step) {
    case 'allPages':
      return t('ocr.allPages')
    case 'carryOn':
      return t('ocr.carryOn')
    case 'retry':
      return t('ocr.retry')
    case 'check':
      return t('ocr.check')
    case 'layerText':
      return t('ocr.layerText')
    case 'furniture':
      return t('ocr.furniture')
    case 'pageMarks':
      return t('ocr.pageMarks')
  }
}

export function stepDesc(step: Step): string {
  switch (step) {
    case 'allPages':
      return t('ocr.allPagesDesc')
    case 'carryOn':
      return t('ocr.carryOnDesc')
    case 'retry':
      return t('ocr.retryDesc')
    case 'check':
      return t('ocr.checkDesc')
    case 'layerText':
      return t('ocr.layerTextDesc')
    case 'furniture':
      return t('ocr.furnitureDesc')
    case 'pageMarks':
      return t('ocr.pageMarksDesc')
  }
}

/**
 * Asks how the documents are to be read before they are: the steps, as last chosen. The
 * choices come back, to be kept; null when the reader went no further.
 */
export function askScanOptions(
  app: App,
  heading: string,
  text: string,
  confirm: string,
  current: OcrSettings
): Promise<OcrSettings | null> {
  return new Promise((resolve) => new ScanOptionsModal(app, heading, text, confirm, { ...current }, resolve).open())
}

class ScanOptionsModal extends Modal {
  private done = false

  constructor(
    app: App,
    private heading: string,
    private text: string,
    private confirm: string,
    private chosen: OcrSettings,
    private resolve: (value: OcrSettings | null) => void
  ) {
    super(app)
  }

  onOpen(): void {
    this.setTitle(this.heading)
    this.modalEl.addClass('pm-scan-options')
    this.contentEl.createEl('p', { cls: 'pm-scan-options-text', text: this.text })
    renderOcrOptions(this.contentEl.createDiv('pm-scan-options-list'), this.chosen)
    const buttons = this.contentEl.createDiv('pm-modal-btn-row')
    new ButtonComponent(buttons).setButtonText(t('common.cancel')).onClick(() => this.close())
    new ButtonComponent(buttons)
      .setButtonText(this.confirm)
      .setCta()
      .onClick(() => {
        this.done = true
        this.resolve(this.chosen)
        this.close()
      })
  }

  onClose(): void {
    this.contentEl.empty()
    if (!this.done) this.resolve(null)
  }
}
