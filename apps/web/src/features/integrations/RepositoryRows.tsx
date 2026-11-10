import type { Integration } from '@circi/api'
import { ChevronRightIcon, Badge, Banner, Button, Select, Text, TextField } from '@circi/ui'
import { useQuery } from '@tanstack/react-query'
import { type FormEvent, type ReactNode, useState } from 'react'

import { repositoryRows, targetsQuery } from './api/generic.ts'

import styles from './Integrations.module.css'

/** The picker's "no team" choice; a team slug can't be this. */
const NONE = '~none'

/**
 * A git host's repositories, each with the team its pull requests report to (GitHub, GitLab and
 * Bitbucket share this). The rows are the repositories the host offers; one the host no longer
 * lists but a team still reports to says "Needs attention" with Reinstall. Choosing a team (or
 * "Not linked") saves at once. The server stores it the other way round (a team has one
 * repository), so choosing a team moves that team here from its old repository.
 */
export function RepositoryRows(props: RepositoryRows.Props) {
  const { teams, spec } = props
  const targets = useQuery({
    ...targetsQuery(props.workspace, props.integrationId),
    enabled: props.canManage,
  })
  const rows = repositoryRows(teams, props.canManage ? (targets.data?.targets ?? null) : null)
  const items = [
    { value: NONE, label: 'Not linked' },
    ...teams.map((t) => ({ value: t.slug, label: t.name })),
  ]
  const [typed, setTyped] = useState('')
  const [typedTeam, setTypedTeam] = useState(teams[0]?.slug ?? '')
  const noun = spec.targetLabel.toLowerCase()

  function choose(row: { ref: string; team: string | null }, next: string) {
    const to = next === NONE ? null : next
    if (to === row.team) return
    props.onAssign({ ref: row.ref, from: row.team, to })
  }

  function add(e: FormEvent) {
    e.preventDefault()
    if (typed.trim() === '' || typedTeam === '') return
    props.onAssign({ ref: typed.trim(), from: null, to: typedTeam })
    setTyped('')
  }

  return (
    <>
      {targets.isPending && props.canManage ? (
        <Text tone="secondary" variant="small">
          Loading {noun}s…
        </Text>
      ) : null}
      {rows.length === 0 && !targets.isPending ? (
        targets.error ? (
          <Banner>
            {`CirCI couldn't list the ${noun}s: ${targets.error.message}`}
            {props.canManage ? ' Add one by name below.' : null}
          </Banner>
        ) : (
          <Text variant="small" tone="secondary">
            {props.canManage ? `No ${noun}s yet. Add one by name below.` : `No ${noun}s yet.`}
          </Text>
        )
      ) : null}
      {rows.length > 0 ? (
        <ul className={styles.box} aria-label={`${spec.targetLabel}s`}>
          {rows.map((row) => {
            const team = teams.find((t) => t.slug === row.team)
            return (
              <li key={row.ref}>
                <div className={styles.row}>
                  <span className={styles.name}>
                    <Text variant="mono">{row.label}</Text>
                    {row.broken ? (
                      <span>
                        <Badge tone="state" state="failed" shape="tag">
                          Needs attention: the app was uninstalled from this {noun}
                        </Badge>
                      </span>
                    ) : null}
                  </span>
                  <ChevronRightIcon size={14} aria-hidden="true" className={styles.arrow} />
                  {props.canManage ? (
                    <Select
                      className={styles.picker}
                      label={`Team for ${row.label}`}
                      hideLabel
                      items={items}
                      value={row.team ?? NONE}
                      onValueChange={(v) => choose(row, v)}
                    />
                  ) : (
                    <Text>{team?.name ?? 'Not linked'}</Text>
                  )}
                  {row.broken && props.reinstall ? props.reinstall : null}
                </div>
              </li>
            )
          })}
        </ul>
      ) : null}
      {props.canManage && teams.length > 0 ? (
        <form onSubmit={add} noValidate aria-label={`Add a ${noun}`} className={styles.inline}>
          <TextField
            className={styles.grow}
            label={`Add a ${noun} by name`}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            {...(spec.targetPlaceholder ? { placeholder: spec.targetPlaceholder } : {})}
          />
          <Select
            label="Team"
            items={teams.map((t) => ({ value: t.slug, label: t.name }))}
            value={typedTeam}
            onValueChange={setTypedTeam}
          />
          <Button type="submit" disabled={typed.trim() === ''}>
            Link {noun}
          </Button>
        </form>
      ) : null}
    </>
  )
}

export namespace RepositoryRows {
  export interface Props {
    workspace: string
    integrationId: string
    spec: Integration.MappingSpec
    teams: Integration.MappingTeam[]
    canManage: boolean
    /** Moves `ref` from team `from` (cleared) to team `to` (saved); null `to` only clears. */
    onAssign: (input: { ref: string; from: string | null; to: string | null }) => void
    /** The Reinstall button a broken row shows. */
    reinstall?: ReactNode
  }
}
