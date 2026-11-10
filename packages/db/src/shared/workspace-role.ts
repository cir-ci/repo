/** A member row's role as one of the three roles (better-auth stores it as text; anything else is a member). */
export type WorkspaceRole = 'owner' | 'admin' | 'member'

export const asWorkspaceRole = (role: string): WorkspaceRole =>
  role === 'owner' || role === 'admin' ? role : 'member'
