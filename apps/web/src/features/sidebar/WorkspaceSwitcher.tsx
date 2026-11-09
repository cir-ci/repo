import { CheckIcon, ChevronsUpDownIcon, Menu, PlusIcon, SlidersIcon, Text } from '@circi/ui'
import { useNavigate } from '@tanstack/react-router'

import type { WorkspaceRef } from '#app/shell-model.ts'

import { WorkspaceTile } from './WorkspaceTile.tsx'

import styles from './WorkspaceSwitcher.module.css'

/**
 * The workspace the sidebar is about, at its top: a menu of the workspaces the person can see
 * (the open one is marked), a way to its settings and, when allowed, "Create workspace". A Base UI
 * menu: arrow keys move, Escape closes and focus returns to the button.
 */
export function WorkspaceSwitcher({
  workspaces,
  current,
  onSelect,
  onCreate,
}: WorkspaceSwitcher.Props) {
  const navigate = useNavigate()
  if (!current) return <div className={styles.brand}>CirCI</div>
  return (
    <Menu
      trigger={
        <button type="button" className={styles.trigger} aria-label={`Workspace: ${current.name}`}>
          <WorkspaceTile name={current.name} slug={current.slug} current={current.slug} />
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
            <WorkspaceTile name={workspace.name} slug={workspace.slug} current={current.slug} />
          ),
          current: workspace.slug === current.slug,
          ...(workspace.slug === current.slug ? { trailing: <CheckIcon /> } : {}),
          onSelect: () => onSelect(workspace),
        })),
        { type: 'separator' },
        {
          label: 'Workspace settings',
          icon: <SlidersIcon />,
          onSelect: () =>
            void navigate({
              to: '/workspaces/$workspace/settings',
              params: { workspace: current.slug },
            }),
        },
        ...(onCreate
          ? [
              {
                label: 'Create workspace',
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
  }
}
