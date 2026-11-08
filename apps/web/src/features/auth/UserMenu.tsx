import {
  Avatar,
  ChevronsUpDownIcon,
  ColorSchemeControl,
  LogOutIcon,
  Menu,
  UserIcon,
} from '@circi/ui'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'

import { authClient, type SessionUser } from '#lib/auth-client.ts'

import styles from './UserMenu.module.css'

/**
 * Provisional (docs/design-gaps.md §6): the signed-in person at the bottom of the sidebar: who
 * they are, a way to their account, the colour scheme, and a way to sign out.
 */
export function UserMenu({ user }: UserMenu.Props) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()

  async function signOut() {
    await authClient.signOut()
    // Forget everything fetched as this person, so the next one never sees it.
    queryClient.clear()
  }

  return (
    <Menu
      align="start"
      trigger={
        <button
          type="button"
          className={styles.trigger}
          aria-label={`Account menu for ${user.name}`}
        >
          <Avatar name={user.name} size={24} />
          <span className={styles.name}>{user.name}</span>
          <ChevronsUpDownIcon />
        </button>
      }
      items={[
        {
          type: 'content',
          name: 'who',
          node: (
            <div className={styles.who}>
              <span className={styles.whoName}>{user.name}</span>
              <span className={styles.whoEmail}>{user.email}</span>
            </div>
          ),
        },
        { type: 'separator' },
        { label: 'Account', icon: <UserIcon />, onSelect: () => void navigate({ to: '/account' }) },
        { type: 'content', name: 'theme', node: <ColorSchemeControl /> },
        { type: 'separator' },
        { label: 'Sign out', icon: <LogOutIcon />, onSelect: () => void signOut() },
      ]}
    />
  )
}

export namespace UserMenu {
  export interface Props {
    user: SessionUser
  }
}
