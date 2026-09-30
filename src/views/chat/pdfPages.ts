import { loadPdfJs } from 'obsidian'
import type { OcrSource } from '../../store/chat/ocr'

/**
 * A PDF's pages as pictures, drawn by the PDF.js Obsidian ships for its own viewer.
 *
 * Drawn rather than taken apart: a scan may hold its pages as JPEG, as fax-coded black
 * and white, as JPEG 2000, or as a Gantt drawn in lines with its text turned to shapes,
 * and a model can only be handed what a browser shows. What the viewer can show, this
 * can hand over.
 */

interface PdfJsViewport {
  width: number
  height: number
}

interface PdfJsPage {
  getViewport(options: { scale: number }): PdfJsViewport
  render(options: { canvasContext: CanvasRenderingContext2D; viewport: PdfJsViewport }): { promise: Promise<void> }
  getTextContent(): Promise<{ items: { str?: string; hasEOL?: boolean }[] }>
  cleanup(): void
}

interface PdfJsDocument {
  numPages: number
  getPage(page: number): Promise<PdfJsPage>
  destroy(): Promise<void>
}

interface PdfJs {
  getDocument(source: { data: Uint8Array }): { promise: Promise<PdfJsDocument> }
}

/**
 * How large a page is drawn: its longer side about two thousand pixels, enough for the
 * small print of a planning's table and the scale of its bars, within what a model takes.
 */
const LONG_SIDE = 2000

export async function pdfPages(bytes: Uint8Array): Promise<OcrSource & { close: () => void }> {
  const pdfjs = (await loadPdfJs()) as PdfJs
  // A copy: PDF.js may take the buffer it is given for its worker.
  const doc = await pdfjs.getDocument({ data: bytes.slice() }).promise
  return {
    pages: doc.numPages,
    render: async (number) => {
      const page = await doc.getPage(number)
      const plain = page.getViewport({ scale: 1 })
      const scale = Math.min(4, LONG_SIDE / Math.max(plain.width, plain.height))
      const viewport = page.getViewport({ scale })
      const canvas = createEl('canvas')
      canvas.width = Math.ceil(viewport.width)
      canvas.height = Math.ceil(viewport.height)
      const context = canvas.getContext('2d')
      if (!context) throw new Error('canvas')
      // White under the page: a PDF's background is nothing, which a JPEG makes black.
      context.fillStyle = '#ffffff'
      context.fillRect(0, 0, canvas.width, canvas.height)
      await page.render({ canvasContext: context, viewport }).promise
      page.cleanup()
      return canvas.toDataURL('image/jpeg', 0.85)
    },
    // What the file itself holds on the page, when it holds text: what a reading is checked against.
    layer: async (number) => {
      const page = await doc.getPage(number)
      const content = await page.getTextContent()
      return content.items.map((item) => `${item.str ?? ''}${item.hasEOL ? '\n' : ''}`).join('')
    },
    close: () => {
      doc.destroy().catch(() => undefined)
    }
  }
}
