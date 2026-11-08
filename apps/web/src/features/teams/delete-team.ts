/** Deleting a team asks for its address (`workspace/team`) typed back, so it is never an accident. */
export const deletePhrase = (workspace: string, team: string): string => `${workspace}/${team}`

/** Whether what was typed is the phrase (surrounding spaces don't count; case does). */
export const deleteConfirmed = (typed: string, phrase: string): boolean => typed.trim() === phrase
