/**
 * A passage chosen in a note, asked about.
 *
 * It goes with the question it was chosen for, quoted under it — in the conversation and
 * in its note alike — so the record says what was asked about, and a follow-up question
 * still has it in the history the model is sent. Chosen again for the next question if
 * it is still wanted: a selection is a moment's context, not a standing one like the
 * open note.
 */

/** How much of a passage goes with a question: pages of it, not a whole book. */
export const SELECTION_BUDGET = 20000

/** The question with the passage quoted under it, cut where it runs past the budget. */
export function withSelection(
  question: string,
  selection: string,
  cut: (sent: number, total: number) => string,
  budget = SELECTION_BUDGET
): string {
  const text = selection.replace(/\r\n?/g, '\n').trim()
  if (!text) return question
  let sent = text
  let tail = ''
  if (text.length > budget) {
    const line = text.lastIndexOf('\n', budget)
    sent = text.slice(0, line > budget * 0.8 ? line : budget).trimEnd()
    tail = `\n\n${cut(sent.length, text.length)}`
  }
  const quoted = sent
    .split('\n')
    .map((line) => (line.trim() ? `> ${line}` : '>'))
    .join('\n')
  return `${question.trim()}\n\n${quoted}${tail}`
}
