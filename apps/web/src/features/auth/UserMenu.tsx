import {
  Avatar,
  BellIcon,
  ColorSchemeControl,
  KeyboardIcon,
  LogOutIcon,
  Menu,
  ShieldCheckIcon,
  SunIcon,
  UserIcon,
} from '@circi/ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'

import { capabilitiesQuery } from '#features/teams/api/index.ts'
import { authClient, type SessionUser } from '#lib/auth-client.ts'

import styles from './UserMenu.module.css'

/**
 * The account button at the bottom of the sidebar and the menu it opens: who you are, profile
 * and sessions (a 28px avatar beside your name and email; 228px wide, 32px rows), notifications, the theme (System, Light, Dark in a segmented picker under its own line; the page
 * changes at once), keyboard shortcuts, the instance's admin pages when you run it, and
 * sign out. A Base UI menu: Escape closes it and focus returns to the button.
 */
export function UserMenu({ user }: UserMenu.Props) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const { data: caps } = useQuery(capabilitiesQuery())

  async function signOut() {
    await authClient.signOut()
    // Forget everything fetched as this person, so the next one never sees it.
    queryClient.clear()
  }

  return (
    <Menu
      align="start"
      size="md"
      className={styles.menu}
      trigger={
        <button
          type="button"
          className={styles.trigger}
          aria-label={`Account menu for ${user.name}`}
        >
          <Avatar type="user" id={user.id} name={user.name} image={user.image} size={20} />
          <span className={styles.name}>{user.name}</span>
        </button>
      }
      items={[
        {
          type: 'content',
          name: 'who',
          node: (
            <div className={styles.who}>
              <Avatar
                type="user"
                aria-hidden
                id={user.id}
                name={user.name}
                image={user.image}
                size={28}
              />
              <span className={styles.whoText}>
                <span className={styles.whoName}>{user.name}</span>
                <span className={styles.whoEmail}>{user.email}</span>
              </span>
            </div>
          ),
        },
        { type: 'separator' },
        {
          label: 'Profile and sessions',
          icon: <UserIcon />,
          onSelect: () => void navigate({ to: '/account/profile' }),
        },
        {
          label: 'Notifications',
          icon: <BellIcon />,
          onSelect: () => void navigate({ to: '/account/notifications' }),
        },
        {
          // "Theme" on its own line, the picker full width below it: three buttons in the menu's
          // 228px (the old inline picker clipped at the right edge).
          type: 'content',
          name: 'theme',
          node: (
            <div className={styles.theme}>
              <span className={styles.themeLabel}>
                <SunIcon aria-hidden="true" />
                Theme
              </span>
              <ColorSchemeControl fill />
            </div>
          ),
        },
        {
          label: 'Keyboard shortcuts',
          icon: <KeyboardIcon />,
          shortcut: '?',
          onSelect: () => void navigate({ to: '/account/shortcuts' }),
        },
        { type: 'separator' },
        ...(caps?.instanceAdmin
          ? [
              {
                label: 'Instance admin',
                icon: <ShieldCheckIcon />,
                onSelect: () => void navigate({ to: '/instance/accounts' }),
              } satisfies Menu.Item,
            ]
          : []),
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
