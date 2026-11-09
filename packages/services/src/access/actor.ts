/**
 * Who is asking, as far as an access decision needs to know. Authentication stays in the
 * transport layer; the adapter resolves the actor's standing and hands it to the policies.
 */
export interface Actor {
  userId: string
  /** Whether the user administers the whole instance. */
  instanceAdmin: boolean
  /**
   * The user's role (`owner`, `admin`, `member`) in the workspace or team's workspace being
   * accessed, or undefined when the workspace is not visible to them: they are not a member,
   * it does not exist, or it refuses how they signed in.
   */
  role: string | undefined
}
