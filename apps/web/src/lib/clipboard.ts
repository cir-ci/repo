/** Where the browser copies text to; a seam so tests can watch it. */
export const clipboard = {
  write: (text: string) => navigator.clipboard.writeText(text),
}
