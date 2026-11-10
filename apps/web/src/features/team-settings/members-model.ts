/** The pure parts of a team's Members tab: who can be added, and what the dialogs say. */

export interface WorkspaceMember {
  userId: string
  role: string
  user: { id: string; name: string; email: string; image?: string | null | undefined }
}

export const ROLE_LABEL: Record<string, string> = {
  owner: 'Owner',
  admin: 'Admin',
  member: 'Member',
}

/**
 * The workspace members who aren't in the team yet and match what was typed (in their name or
 * email, case aside), in the workspace's order.
 */
export function addCandidates(
  workspaceMembers: ReadonlyArray<WorkspaceMember>,
  inTeam: ReadonlyArray<{ id: string }>,
  query: string,
): WorkspaceMember[] {
  const taken = new Set(inTeam.map((m) => m.id))
  const needle = query.trim().toLowerCase()
  return workspaceMembers.filter(
    (m) =>
      !taken.has(m.userId) &&
      (!needle ||
        m.user.name.toLowerCase().includes(needle) ||
        m.user.email.toLowerCase().includes(needle)),
  )
}

/** The Add button: "Add 1 member", "Add 3 members". */
export const addLabel = (n: number) => `Add ${n} ${n === 1 ? 'member' : 'members'}`

/** The confirmation for taking someone out of a team, or for leaving it yourself. */
export function removalText(
  team: string,
  who: { name: string; you: boolean },
): { title: string; text: string; button: string } {
  return who.you
    ? {
        title: `Leave ${team}?`,
        text: `You will stop getting ${team}'s review requests and mentions, and it leaves your sidebar. Your past reviews and comments stay. An owner or admin can add you back.`,
        button: 'Leave team',
      }
    : {
        title: `Remove ${who.name} from ${team}?`,
        text: `They will stop getting ${team}'s review requests and mentions, and it leaves their sidebar. They are also taken out of its review rules and triage rotation. Their past reviews and comments stay.`,
        button: 'Remove',
      }
}
