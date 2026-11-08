import { Avatar, CheckIcon, ChevronsUpDownIcon, Menu } from '@circi/ui'

import type { WorkspaceRef } from './shell-model.ts'

import styles from './WorkspaceSwitcher.module.css'

/**
 * Provisional (docs/design-gaps.md §6): the workspace the sidebar is about, at its top. A menu
 * of the workspaces the person can see; with only one it still shows that one's name.
 */
export function WorkspaceSwitcher({ workspaces, current, onSelect }: WorkspaceSwitcher.Props) {
  if (!current) return <div className={styles.brand}>CirCI</div>
  return (
    <Menu
      trigger={
        <button type="button" className={styles.trigger} aria-label={`Workspace: ${current.name}`}>
          <Avatar name={current.name} size={24} />
          <span className={styles.name}>{current.name}</span>
          <ChevronsUpDownIcon />
        </button>
      }
      items={workspaces.map((workspace) => ({
        label: workspace.name,
        onSelect: () => onSelect(workspace),
        ...(workspace.slug === current.slug ? { icon: <CheckIcon /> } : {}),
      }))}
    />
  )
}

export namespace WorkspaceSwitcher {
  export interface Props {
    workspaces: readonly WorkspaceRef[]
    current: WorkspaceRef | undefined
    onSelect: (workspace: WorkspaceRef) => void
  }
}
