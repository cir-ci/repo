import {
  Avatar,
  BellIcon,
  KeyboardIcon,
  LogOutIcon,
  Menu,
  ShieldCheckIcon,
  UserIcon,
  useColorScheme,
} from '@circi/ui'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'

import { authClient, type SessionUser } from '#lib/auth-client.ts'
import { isInstanceAdmin } from '#lib/instance-admin.ts'

import styles from './UserMenu.module.css'

const THEMES = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
] as const

/**
 * The account button at the bottom of the sidebar and the menu it opens: who you are, profile
 * and sessions, notifications, the theme (a radio group: arrow keys move, Enter or Space picks, and
 * the page changes at once), keyboard shortcuts, the instance's admin pages when you run it, and
 * sign out. A Base UI menu: Escape closes it and focus returns to the button.
 */
export function UserMenu({ user }: UserMenu.Props) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const { mode, setMode } = useColorScheme()

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
          <Avatar name={user.name} size={20} />
          <span className={styles.name}>{user.name}</span>
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
          type: 'radio-group',
          name: 'Theme',
          value: mode,
          options: THEMES,
          onValueChange: (value) => {
            const next = THEMES.find((t) => t.value === value)
            if (next) setMode(next.value)
          },
        },
        {
          label: 'Keyboard shortcuts',
          icon: <KeyboardIcon />,
          shortcut: '?',
          onSelect: () => void navigate({ to: '/account/shortcuts' }),
        },
        { type: 'separator' },
        ...(isInstanceAdmin(user)
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
