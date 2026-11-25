/**
 * URL validation — shared predicate for everywhere the app accepts a URL
 * (SaveUrl modal, Import paste parser, bookmark import). Previously written
 * inline three times.
 */
export function isValidHttpUrl(text: string): boolean {
  try {
    const url = new URL(text.trim());
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}
