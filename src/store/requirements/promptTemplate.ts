/**
 * Instructions the reader owns, and contracts they do not.
 *
 * Every prompt in this plugin divides the same way. The guidance — the role, the tone,
 * what to judge and what never to invent — is a judgement about how this organisation
 * works, and belongs to whoever is doing the work. The output contract — the field names
 * the interface reads back and the vocabulary its badges match on — is a machine
 * interface, and an instruction somebody rewords there by accident is a feature that
 * arrives and shows nothing, for reasons invisible from the outside.
 *
 * So the guidance is a template and the contract is appended, always, by the one routine
 * here rather than by three that would drift.
 */

/**
 * Fills the placeholders, and leaves everything else alone.
 *
 * Only the names it knows are replaced: a brace somebody typed in prose is prose, and a
 * template that silently ate it would be a template nobody could write French in.
 */
export function applyPromptTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) => (key in values ? values[key] : whole))
}

/**
 * A whole prompt: the reader's instruction, filled in, with the contract after it.
 *
 * An empty instruction falls back to the shipped one rather than being sent: a field
 * somebody cleared by accident should not quietly turn a review into whatever the model
 * feels like doing.
 */
export function fillPrompt(
  template: string,
  fallback: string,
  values: Record<string, string>,
  contract: string
): string {
  const body = (template.trim() || fallback)
    .split('\n')
    .map((line) => ({ line, filled: applyPromptTemplate(line, values) }))
    // A line that was nothing but a placeholder, and whose placeholder had nothing to
    // say, disappears rather than leaving a blank in the middle of the instruction. A
    // blank line somebody typed on purpose has no placeholder in it and is kept.
    .filter(({ line, filled }) => filled.trim() !== '' || !/\{\w+\}/.test(line))
    .map(({ filled }) => filled)
    .join('\n')
    .trim()
  return contract.trim() ? `${body}\n\n${contract.trim()}` : body
}

/** The placeholders a template may use, for a settings page that has to list them. */
export function promptKeys(values: Record<string, string>): string[] {
  return Object.keys(values)
}
