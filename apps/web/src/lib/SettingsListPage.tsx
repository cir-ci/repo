import { ChevronRightIcon, ListRow, NoResults, Text } from '@circi/ui'
import type { NavigateOptions } from '@tanstack/react-router'
import type { ReactNode } from 'react'

import { FindField } from '#lib/FindField.tsx'
import { PageFrame } from '#lib/PageFrame.tsx'
import { useClientLink } from '#lib/use-client-link.ts'

import styles from './SettingsListPage.module.css'

/**
 * A settings page that is a list of things (All projects, All workspaces): the page header with the
 * find field and the main action, a way up above the list, then `children` (one or more
 * `SettingsList`s), or what to show when nothing matches what was typed or there is nothing yet.
 */
export function SettingsListPage({
  noun,
  singular,
  search,
  onSearch,
  count,
  empty,
  back,
  children,
  ...frame
}: SettingsListPage.Props) {
  return (
    <PageFrame {...frame} find={<FindField noun={noun} value={search} onChange={onSearch} />}>
      {back}
      {count === 0 && search.trim() ? (
        <NoResults noun={singular} query={search} onClear={() => onSearch('')} size="section" />
      ) : count === 0 ? (
        empty
      ) : (
        children
      )}
    </PageFrame>
  )
}

export namespace SettingsListPage {
  export interface Props extends Pick<
    PageFrame.Props,
    'crumbs' | 'title' | 'actions' | 'loading' | 'error' | 'onRetry' | 'forbidden'
  > {
    /** Plural, for the find field: "projects". */
    noun: string
    /** Singular, for "No project matches ...". */
    singular: string
    search: string
    onSearch: (value: string) => void
    /** How many rows the search leaves, across every list. */
    count: number
    /** Shown when there are no rows and nothing was typed. */
    empty: ReactNode
    /** The way up, above the list. */
    back?: ReactNode
    children: ReactNode
  }
}

/** One bordered list of rows; `title` heads a group under another list ("Deleted"). */
export function SettingsList({ label, title, children }: SettingsList.Props) {
  const list = (
    <ul aria-label={label} className={styles.list}>
      {children}
    </ul>
  )
  if (!title) return list
  return (
    <div className={styles.group}>
      <Text variant="small" tone="secondary" className={styles.groupTitle}>
        {title}
      </Text>
      {list}
    </div>
  )
}

export namespace SettingsList {
  export interface Props {
    /** The list's accessible name. */
    label: string
    title?: string
    children: ReactNode
  }
}

/** A row of a `SettingsList`: its avatar, a name over a mono line, and what trails (ending in a chevron). */
export function SettingsListRow({ link, leading, name, detail, trailing }: SettingsListRow.Props) {
  const clientLink = useClientLink()
  return (
    <li>
      <ListRow
        {...clientLink(link)}
        leading={leading}
        trailing={
          <span className={styles.trailing}>
            {trailing}
            <ChevronRightIcon size={12} />
          </span>
        }
      >
        <span className={styles.names}>
          <Text truncate>{name}</Text>
          <Text variant="mono" tone="tertiary" truncate>
            {detail}
          </Text>
        </span>
      </ListRow>
    </li>
  )
}

export namespace SettingsListRow {
  export interface Props {
    link: NavigateOptions
    leading: ReactNode
    name: string
    detail: string
    trailing: ReactNode
  }
}
