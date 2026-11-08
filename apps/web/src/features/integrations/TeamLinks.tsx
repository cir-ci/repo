import type { Integration } from '@circi/api'
import { Badge, Banner, Button, Text, TextField } from '@circi/ui'
import { useQuery } from '@tanstack/react-query'
import { type FormEvent, useState } from 'react'

import { autoLinkSummary, linksQuery, linkValuesComplete, useLinks } from './generic-api.ts'

import styles from './Links.module.css'

/**
 * A mapped team's links, for a definition with a `links` section (Figma's snapshot-to-frame
 * table): what is linked, how it was made (automatically or by hand), add and remove, and the
 * "Link automatically" button when the definition offers it. Rendered from the section's spec,
 * so nothing here knows Figma.
 */
export function TeamLinks({ workspace, integrationId, spec, team, canManage }: TeamLinks.Props) {
  const { data, error } = useQuery(linksQuery(workspace, integrationId, team.slug))
  const actions = useLinks(workspace, integrationId)
  const [values, setValues] = useState<Record<string, string>>({})
  const complete = linkValuesComplete(spec, values)

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!complete) return
    actions.create.mutate({ team: team.slug, values }, { onSuccess: () => setValues({}) })
  }

  return (
    <div
      className={styles.root}
      role="group"
      aria-label={`${team.name} ${spec.label.toLowerCase()}`}
    >
      <div className={styles.linksHead}>
        <Text variant="small" tone="secondary">
          {spec.label}
        </Text>
        {canManage && spec.autoLink && team.mapping ? (
          <Button
            loading={actions.auto.isPending}
            onClick={() => actions.auto.mutate(team.slug)}
            aria-label={`Link ${team.name} automatically`}
          >
            Link automatically
          </Button>
        ) : null}
      </div>
      {actions.auto.data ? <Banner>{autoLinkSummary(actions.auto.data)}</Banner> : null}
      {actions.auto.error ? <Banner tone="danger">{actions.auto.error.message}</Banner> : null}
      {actions.remove.error ? <Banner tone="danger">{actions.remove.error.message}</Banner> : null}
      {error ? <Banner tone="danger">{error.message}</Banner> : null}
      {data && data.links.length === 0 ? (
        <Text variant="small" tone="secondary">
          {spec.autoLink
            ? 'No links yet. Link automatically matches names to snapshots with the same name.'
            : 'No links yet.'}
        </Text>
      ) : null}
      {data && data.links.length > 0 ? (
        <table className={styles.table} aria-label={`${team.name} ${spec.label.toLowerCase()}`}>
          <thead>
            <tr>
              <th scope="col">{spec.fields.find((f) => f.key === spec.subject)?.label}</th>
              <th scope="col">{spec.targetLabel}</th>
              <th scope="col">How</th>
              <th scope="col">
                <span className={styles.srOnly}>Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {data.links.map((l) => (
              <tr key={l.id}>
                <td>
                  <Text variant="mono">{l.subject}</Text>
                </td>
                <td>
                  {l.url ? (
                    <a href={l.url} target="_blank" rel="noopener noreferrer">
                      {l.title ?? l.ref}
                    </a>
                  ) : (
                    (l.title ?? l.ref)
                  )}
                </td>
                <td>
                  <Badge shape="tag">{l.source === 'auto' ? 'Auto' : 'Manual'}</Badge>
                </td>
                <td className={styles.actions}>
                  {canManage ? (
                    <Button
                      variant="danger"
                      onClick={() => actions.remove.mutate({ team: team.slug, linkId: l.id })}
                      aria-label={`Remove link ${l.subject}`}
                    >
                      Remove
                    </Button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {canManage ? (
        <form
          onSubmit={submit}
          noValidate
          className={styles.addRow}
          aria-label={`Add a link to ${team.name}`}
        >
          {spec.fields.map((field) => (
            <TextField
              key={field.key}
              className={styles.grow}
              label={`${team.name} ${field.label.toLowerCase()}`}
              value={values[field.key] ?? ''}
              onChange={(e) => setValues((cur) => ({ ...cur, [field.key]: e.target.value }))}
              {...(field.placeholder ? { placeholder: field.placeholder } : {})}
              {...(field.description ? { description: field.description } : {})}
            />
          ))}
          <Button
            type="submit"
            variant="primary"
            loading={actions.create.isPending}
            disabled={!complete}
          >
            Add link
          </Button>
        </form>
      ) : null}
      {actions.create.error ? <Banner tone="danger">{actions.create.error.message}</Banner> : null}
    </div>
  )
}

export namespace TeamLinks {
  export interface Props {
    workspace: string
    integrationId: string
    spec: Integration.LinksSpec
    team: Integration.MappingTeam
    canManage: boolean
  }
}
