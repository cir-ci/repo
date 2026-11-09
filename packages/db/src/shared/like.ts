/** Escapes `%`, `_` and `\\` so typed text matches literally inside `like` / `ilike`. */
export const containsPattern = (text: string) => `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
