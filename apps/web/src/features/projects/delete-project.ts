/** Deleting a project asks for its address (`workspace/project`) typed back, so it is never an accident. */
export const deletePhrase = (workspace: string, project: string): string =>
  `${workspace}/${project}`

/** Whether what was typed is the phrase (surrounding spaces don't count; case does). */
export const deleteConfirmed = (typed: string, phrase: string): boolean => typed.trim() === phrase
