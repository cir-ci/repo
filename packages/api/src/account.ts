/** `/api/account/…`: the signed-in person's own account. */
export namespace Account {
  /** `GET /api/account/email-change`: an email change that waits for its confirmation link. */
  export interface EmailChange {
    /** The address a confirmation mail went to; null when no change is waiting (or its link expired). */
    pendingEmail: string | null
  }
}
