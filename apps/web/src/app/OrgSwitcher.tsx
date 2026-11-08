import { Avatar, CheckIcon, ChevronsUpDownIcon, Menu } from '@circi/ui'

import type { OrgRef } from './shell-model.ts'

import styles from './OrgSwitcher.module.css'

/**
 * Provisional (docs/design-gaps.md §6): the organization the sidebar is about, at its top. A menu
 * of the organizations the person can see; with only one it still shows that one's name.
 */
export function OrgSwitcher({ orgs, current, onSelect }: OrgSwitcher.Props) {
  if (!current) return <div className={styles.brand}>CirCI</div>
  return (
    <Menu
      trigger={
        <button
          type="button"
          className={styles.trigger}
          aria-label={`Organization: ${current.name}`}
        >
          <Avatar name={current.name} size={24} />
          <span className={styles.name}>{current.name}</span>
          <ChevronsUpDownIcon />
        </button>
      }
      items={orgs.map((org) => ({
        label: org.name,
        onSelect: () => onSelect(org),
        ...(org.slug === current.slug ? { icon: <CheckIcon /> } : {}),
      }))}
    />
  )
}

export namespace OrgSwitcher {
  export interface Props {
    orgs: readonly OrgRef[]
    current: OrgRef | undefined
    onSelect: (org: OrgRef) => void
  }
}
