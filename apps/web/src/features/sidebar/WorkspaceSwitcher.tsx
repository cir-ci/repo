import { CheckIcon, ChevronsUpDownIcon, Menu, PlusIcon, SlidersIcon, Text, Avatar } from '@circi/ui'
import { useNavigate } from '@tanstack/react-router'

import { workspaceSettingsPath, type WorkspaceRef } from '#app/shell-model.ts'

import styles from './WorkspaceSwitcher.module.css'

/**
 * The workspace the sidebar is about, at its top: a menu of the workspaces the person can see
 * (the open one is marked), a way to its settings and, when allowed, "New workspace". A Base UI
 * menu: arrow keys move, Escape closes and focus returns to the button.
 */
export function WorkspaceSwitcher({
  workspaces,
  current,
  onSelect,
  onCreate,
  canManage,
}: WorkspaceSwitcher.Props) {
  const navigate = useNavigate()
  if (!current) return <div className={styles.brand}>CirCI</div>
  return (
    <Menu
      trigger={
        <button type="button" className={styles.trigger} aria-label={`Workspace: ${current.name}`}>
          <Avatar
            type="workspace"
            aria-hidden
            slug={current.slug}
            name={current.name}
            picture={current.picture ?? null}
          />
          <span className={styles.name}>{current.name}</span>
          <ChevronsUpDownIcon size={12} />
        </button>
      }
      items={[
        {
          type: 'content',
          name: 'Workspaces',
          node: (
            <Text as="span" variant="small" tone="tertiary">
              Workspaces
            </Text>
          ),
        },
        ...workspaces.map((workspace): Menu.Item => ({
          label: workspace.name,
          icon: (
            <Avatar
              type="workspace"
              aria-hidden
              slug={workspace.slug}
              name={workspace.name}
              picture={workspace.picture ?? null}
            />
          ),
          current: workspace.slug === current.slug,
          ...(workspace.slug === current.slug ? { trailing: <CheckIcon /> } : {}),
          onSelect: () => onSelect(workspace),
        })),
        { type: 'separator' },
        {
          label: 'Workspace settings',
          icon: <SlidersIcon />,
          onSelect: () => void navigate({ href: workspaceSettingsPath(current.slug, canManage) }),
        },
        ...(onCreate
          ? [
              {
                label: 'New workspace',
                icon: <PlusIcon />,
                onSelect: onCreate,
              } satisfies Menu.Item,
            ]
          : []),
      ]}
    />
  )
}

export namespace WorkspaceSwitcher {
  export interface Props {
    workspaces: readonly WorkspaceRef[]
    current: WorkspaceRef | undefined
    onSelect: (workspace: WorkspaceRef) => void
    /** Present when the person may create workspaces. */
    onCreate?: () => void
    /** Whether the person may change the workspace's settings; false opens Members instead of General. */
    canManage?: boolean | undefined
  }
}
