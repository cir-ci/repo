/** Taking back what a person just did. */
export namespace Undo {
  /**
   * What an undoable action returns as `undo`: the token for `POST …/undo/:id` (a team's actions
   * under `/api/teams/:workspace/:team/undo/:id`, the inbox's under `/api/inbox/undo/:id`). Only
   * the same person, once, until `expiresAt`; 409 when something newer changed the same thing.
   * Null when the action changed nothing, so there is nothing to undo.
   */
  export interface Token {
    id: string
    expiresAt: string
  }

  /** The `undo` field of an action's answer. */
  export interface Field {
    undo: Token | null
  }

  /** `POST …/undo/:id`. */
  export interface Done {
    undone: true
  }
}
