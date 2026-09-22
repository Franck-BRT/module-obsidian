/**
 * Escaping, for the formats this plugin writes by hand.
 *
 * Shared because two of them now need it — ReqIF and Word — and a second copy of this is
 * a second place for a character to be forgotten. All five, always, including the
 * apostrophe: the same function writes attribute values, and a requirement about
 * "l'ouverture" would close one.
 */
export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}
