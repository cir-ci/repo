import type { Sidebar, View } from '@circi/api'
import { CommandDialog, Kbd, Pane, SearchIcon, Text, useColorScheme } from '@circi/ui'
import { useParams, useRouter, useRouterState } from '@tanstack/react-router'
import { type KeyboardEvent, useEffect, useId, useRef, useState } from 'react'

import { keyCaps } from '#lib/shortcuts.ts'

import { useSearchResults } from './api.ts'
import {
  type Entry,
  emptyQueryEntries,
  localMatches,
  flatten,
  groupEntries,
  keyEvents,
  normalizeQuery,
  searchEntries,
  wrapIndex,
} from './model.ts'

import styles from './CommandMenu.module.css'

/**
 * The command menu (⌘K): jump to a page, team or saved view and run the actions of the page
 * you are on (from the shortcut registry, with their keys) while the field is empty; search builds,
 * branches, teams and snapshots when it is not. ↑ ↓ move, ↵ chooses, → opens a quick look
 * of the highlighted result, Esc closes.
 */
export function CommandMenu({
  open,
  onOpenChange,
  workspace,
  teams,
  views,
  canManage,
}: CommandMenu.Props) {
  const router = useRouter()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const params = useParams({ strict: false })
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [quickLook, setQuickLook] = useState(false)
  const afterClose = useRef<(() => void) | undefined>(undefined)
  const input = useRef<HTMLInputElement>(null)
  const listId = useId()
  const { mode, setMode } = useColorScheme()

  const q = normalizeQuery(query)
  const { results, pending, failed } = useSearchResults(workspace, q)
  const openTeam =
    workspace !== undefined && params.workspace === workspace && params.team
      ? teams?.find((p) => p.slug === params.team)
      : undefined
  const jump = { workspace, teams, views, canManage }
  const entries =
    q === ''
      ? emptyQueryEntries(pathname, jump, mode)
      : [
          ...localMatches(q, pathname, jump, mode),
          ...(workspace ? searchEntries(workspace, q, results, openTeam) : []),
        ]
  const groups = groupEntries(entries)
  const flat = flatten(groups)
  const current = flat.length === 0 ? -1 : Math.min(active, flat.length - 1)
  const highlighted = current < 0 ? undefined : flat[current]
  const optionId = (i: number) => `${listId}-${i}`

  useEffect(() => {
    if (open && current >= 0)
      document.getElementById(optionId(current))?.scrollIntoView?.({ block: 'nearest' })
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- optionId only depends on listId
  }, [open, current, flat.length])

  function choose(entry: Entry) {
    const { target } = entry
    if (target.type === 'path') {
      router.history.push(target.path)
    } else if (target.type === 'theme') {
      setMode(target.mode)
    } else {
      // A registry action runs through the shortcut layer once the menu has closed, so a dialog
      // it opens is not closed again by the menu giving focus back.
      afterClose.current = () => {
        for (const init of keyEvents(target.key)) {
          window.dispatchEvent(new KeyboardEvent('keydown', init))
        }
      }
    }
    onOpenChange(false)
  }

  function onClosed() {
    setQuery('')
    setActive(0)
    setQuickLook(false)
    const run = afterClose.current
    afterClose.current = undefined
    run?.()
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    const move = (delta: 1 | -1) => {
      e.preventDefault()
      setActive(wrapIndex(flat.length, current, delta))
    }
    if (e.key === 'ArrowDown') move(1)
    else if (e.key === 'ArrowUp') move(-1)
    else if (e.key === 'Enter' && highlighted) {
      e.preventDefault()
      choose(highlighted)
    } else if (
      e.key === 'ArrowRight' &&
      highlighted?.preview &&
      e.currentTarget.selectionStart === e.currentTarget.value.length
    ) {
      e.preventDefault()
      setQuickLook(true)
    } else if (e.key === 'ArrowLeft' && quickLook) {
      e.preventDefault()
      setQuickLook(false)
    }
  }

  const preview = quickLook ? highlighted?.preview : undefined

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} onClosed={onClosed} label="Command menu">
      <div className={styles.main}>
        <div className={styles.field}>
          <SearchIcon aria-hidden="true" />
          <input
            ref={input}
            className={styles.input}
            role="combobox"
            aria-label="Search or run a command"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={current >= 0 ? optionId(current) : undefined}
            aria-autocomplete="list"
            autoComplete="off"
            spellCheck={false}
            placeholder="Search builds, branches, teams, or type a command"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setActive(0)
              setQuickLook(false)
            }}
            onKeyDown={onKeyDown}
          />
        </div>
        <div id={listId} role="listbox" aria-label="Results" className={styles.list}>
          {groups.map(({ group, entries: items }) => (
            <div key={group} role="group" aria-label={group} className={styles.group}>
              <div className={styles.heading} aria-hidden="true">
                {group}
              </div>
              {items.map((entry) => {
                const i = flat.indexOf(entry)
                return (
                  // Keyboard use goes through the field (aria-activedescendant); the click is for the pointer.
                  // oxlint-disable-next-line jsx-a11y/click-events-have-key-events
                  <div
                    key={entry.id}
                    id={optionId(i)}
                    role="option"
                    aria-selected={i === current}
                    className={styles.option}
                    onMouseMove={() => i !== current && setActive(i)}
                    onClick={() => choose(entry)}
                  >
                    <span className={styles.label}>{entry.label}</span>
                    {entry.detail ? <span className={styles.detail}>{entry.detail}</span> : null}
                    {entry.hint ? (
                      <span className={styles.caps}>
                        {keyCaps(entry.hint).map((cap) => (
                          <Kbd key={cap}>{cap}</Kbd>
                        ))}
                      </span>
                    ) : null}
                  </div>
                )
              })}
            </div>
          ))}
        </div>
        <div role="status" className={styles.status}>
          {flat.length === 0 && q !== ''
            ? failed
              ? 'Search failed. Try again.'
              : pending
                ? 'Searching…'
                : `No results for “${q}”`
            : null}
        </div>
        <footer className={styles.footer}>
          <Text variant="micro" tone="tertiary">
            <Kbd>↑</Kbd> <Kbd>↓</Kbd> move · <Kbd>↵</Kbd> open · <Kbd>→</Kbd> quick look ·{' '}
            <Kbd>Esc</Kbd> close
          </Text>
        </footer>
      </div>
      {preview ? (
        <Pane label="Preview" context={preview.title} width="sm" className={styles.pane}>
          <dl className={styles.rows}>
            {preview.rows.map((row) => (
              <div key={row.label}>
                <dt>{row.label}</dt>
                <dd>{row.value}</dd>
              </div>
            ))}
          </dl>
        </Pane>
      ) : null}
    </CommandDialog>
  )
}

export namespace CommandMenu {
  export interface Props {
    open: boolean
    onOpenChange: (open: boolean) => void
    /** The workspace searched and jumped around in. */
    workspace: string | undefined
    /** Whether the person may change the workspace's settings; false sends Settings to Members. */
    canManage?: boolean | undefined
    teams: readonly Sidebar.Team[] | undefined
    views: readonly View.Item[] | undefined
  }
}
