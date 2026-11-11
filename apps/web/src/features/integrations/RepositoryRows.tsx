import type { Integration } from '@circi/api'
import { ChevronRightIcon, Badge, Banner, Button, Select, Text, TextField } from '@circi/ui'
import { useQuery } from '@tanstack/react-query'
import { type FormEvent, type ReactNode, useState } from 'react'

import { repositoryRows, targetsQuery } from './api/generic.ts'

import styles from './Integrations.module.css'

/** The picker's "no project" choice; a project slug can't be this. */
const NONE = '~none'

/**
 * A git host's repositories, each with the project its pull requests report to (GitHub, GitLab and
 * Bitbucket share this). The rows are the repositories the host offers; one the host no longer
 * lists but a project still reports to says "Needs attention" with Reinstall. Choosing a project (or
 * "Not linked") saves at once. The server stores it the other way round (a project has one
 * repository), so choosing a project moves that project here from its old repository.
 */
export function RepositoryRows(props: RepositoryRows.Props) {
  const { projects, spec } = props
  const targets = useQuery({
    ...targetsQuery(props.workspace, props.integrationId),
    enabled: props.canManage,
  })
  const rows = repositoryRows(projects, props.canManage ? (targets.data?.targets ?? null) : null)
  const items = [
    { value: NONE, label: 'Not linked' },
    ...projects.map((t) => ({ value: t.slug, label: t.name })),
  ]
  const [typed, setTyped] = useState('')
  const [typedProject, setTypedProject] = useState(projects[0]?.slug ?? '')
  const noun = spec.targetLabel.toLowerCase()

  function choose(row: { ref: string; project: string | null }, next: string) {
    const to = next === NONE ? null : next
    if (to === row.project) return
    props.onAssign({ ref: row.ref, from: row.project, to })
  }

  function add(e: FormEvent) {
    e.preventDefault()
    if (typed.trim() === '' || typedProject === '') return
    props.onAssign({ ref: typed.trim(), from: null, to: typedProject })
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
            const project = projects.find((t) => t.slug === row.project)
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
                      label={`Project for ${row.label}`}
                      hideLabel
                      items={items}
                      value={row.project ?? NONE}
                      onValueChange={(v) => choose(row, v)}
                    />
                  ) : (
                    <Text>{project?.name ?? 'Not linked'}</Text>
                  )}
                  {row.broken && props.reinstall ? props.reinstall : null}
                </div>
              </li>
            )
          })}
        </ul>
      ) : null}
      {props.canManage && projects.length > 0 ? (
        <form onSubmit={add} noValidate aria-label={`Add a ${noun}`} className={styles.inline}>
          <TextField
            className={styles.grow}
            label={`Add a ${noun} by name`}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            {...(spec.targetPlaceholder ? { placeholder: spec.targetPlaceholder } : {})}
          />
          <Select
            label="Project"
            items={projects.map((t) => ({ value: t.slug, label: t.name }))}
            value={typedProject}
            onValueChange={setTypedProject}
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
    projects: Integration.MappingProject[]
    canManage: boolean
    /** Moves `ref` from project `from` (cleared) to project `to` (saved); null `to` only clears. */
    onAssign: (input: { ref: string; from: string | null; to: string | null }) => void
    /** The Reinstall button a broken row shows. */
    reinstall?: ReactNode
  }
}
