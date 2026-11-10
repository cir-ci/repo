/** Escapes `%`, `_` and `\\` so typed text matches literally inside `like` / `ilike`. */
export const containsPattern = (text: string) => `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`

/** `like` pattern for text that starts with `text`, matched literally. */
export const prefixPattern = (text: string) => `${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`

/** `like` pattern for text with `text` at the start of one of its `/`-separated segments. */
export const segmentPattern = (text: string) => `%/${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
