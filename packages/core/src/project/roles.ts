/** Whether a member's role lets them change a workspace's or project's settings (owners and admins). */
export function canManage(role: string | null | undefined): boolean {
  return role === 'owner' || role === 'admin'
}
