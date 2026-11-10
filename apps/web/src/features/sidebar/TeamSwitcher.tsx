import type { Sidebar } from '@circi/api'
import { CheckIcon, ExpandMoreIcon, Popover, TeamTile } from '@circi/ui'
import { useRouter, useRouterState } from '@tanstack/react-router'
import { type KeyboardEvent, type MouseEvent, useRef, useState } from 'react'

import { matchTeams, rememberTeam, teamSettingsPath } from '#app/shell-model.ts'
import { isTeamIconName } from '#features/teams/appearance.ts'

import styles from './TeamSwitcher.module.css'

/**
 * The team switcher in the Team section's header of the settings nav: a button opening a panel
 * with a search box, the workspace's teams (the current one marked) Picking a team
 * stays on the settings page you are on. Arrow keys move between the search box and the teams,
 * Escape closes it and focus returns to the button.
 */
export function TeamSwitcher({ workspace, teams, current }: TeamSwitcher.Props) {
  const router = useRouter()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const panel = useRef<HTMLDivElement>(null)
  const matches = matchTeams(teams, query)

  const focusables = () =>
    Array.from(panel.current?.querySelectorAll<HTMLElement>('[data-switch-item]') ?? [])

  function onKeyDown(event: KeyboardEvent) {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    const items = focusables()
    const at = items.findIndex((item) => item === document.activeElement)
    const next = event.key === 'ArrowDown' ? at + 1 : at - 1
    const target = items[(next + items.length) % items.length]
    if (target) {
      event.preventDefault()
      target.focus()
    }
  }

  function pick(team: Sidebar.Team, event: MouseEvent) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
      return
    event.preventDefault()
    rememberTeam(workspace, team.slug)
    setOpen(false)
    setQuery('')
    router.history.push(teamSettingsPath(workspace, team.slug, pathname))
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) setQuery('')
      }}
      label="Switch team"
      trigger={
        <button type="button" className={styles.trigger} aria-label="Switch team">
          <ExpandMoreIcon size={12} />
        </button>
      }
      className={styles.popup}
    >
      <div ref={panel} className={styles.panel} onKeyDown={onKeyDown}>
        <input
          data-switch-item=""
          type="search"
          aria-label="Find a team"
          placeholder="Find a team"
          autoComplete="off"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className={styles.search}
        />
        <ul className={styles.list} aria-label="Teams">
          {matches.map((team) => (
            <li key={team.slug}>
              <a
                data-switch-item=""
                href={teamSettingsPath(workspace, team.slug, pathname)}
                aria-current={team.slug === current ? 'true' : undefined}
                onClick={(e) => pick(team, e)}
                className={styles.item}
              >
                <TeamTile
                  name={team.name}
                  seed={team.slug}
                  color={team.color}
                  {...(isTeamIconName(team.icon) ? { icon: team.icon } : {})}
                />
                <span className={styles.name}>{team.name}</span>
                {team.slug === current ? <CheckIcon /> : null}
              </a>
            </li>
          ))}
        </ul>
        {matches.length === 0 ? (
          <p className={styles.none}>{`No team matches “${query}”.`}</p>
        ) : null}
      </div>
    </Popover>
  )
}

export namespace TeamSwitcher {
  export interface Props {
    workspace: string
    teams: readonly Sidebar.Team[]
    /** The slug of the team the nav is about. */
    current: string
  }
}
