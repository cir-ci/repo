import type { Integration } from '@circi/api'
import {
  Banner,
  Button,
  Checkbox,
  EmptyState,
  ListRow,
  SectionHeader,
  Select,
  Text,
  TextField,
} from '@circi/ui'
import { useQuery } from '@tanstack/react-query'
import { useParams, useSearch } from '@tanstack/react-router'
import { type FormEvent, useState } from 'react'

import { Frame } from '#features/settings/Frame.tsx'
import { useDocumentTitle } from '#lib/document-title.ts'

import {
  canSave,
  connectNote,
  type ExtraValues,
  extraToSend,
  initialExtra,
  mappingPageQuery,
  mappingSummary,
  targetItems,
  targetsQuery,
  useInstall,
  useMapping,
} from './generic-api.ts'
import { ProjectLinks } from './ProjectLinks.tsx'

import styles from './Integrations.module.css'

/**
 * The one page for every integration with `pageStyle: 'generic'`: each project maps to one target
 * of the integration (a select of what the account offers, or a typed id) with the settings the
 * definition lists (event toggles, text, switches). Nothing here knows Slack or any other
 * integration: it renders the definition's mapping spec from the API. A project without a target
 * uses nothing.
 */
export function GenericIntegrationPage() {
  const { org, id } = useParams({ from: '/organizations/$org/settings/integrations/$kind/$id' })
  const search: { connect?: unknown } = useSearch({ strict: false })
  const { data, error, refetch } = useQuery(mappingPageQuery(org, id))
  const name = data?.definition.name ?? 'Integration'
  useDocumentTitle(name, 'Integrations', org)
  const mapping = useMapping(org, id)
  const install = useInstall(org)
  const note = connectNote(search.connect, name)
  const spec = data?.definition.mapping ?? null
  const links = data?.definition.links ?? null

  return (
    <Frame
      crumbs={[org, 'Integrations', name]}
      loading={!data && !error}
      error={error}
      onRetry={() => void refetch()}
      notFound="This integration doesn’t exist"
      readOnlyNote={
        data &&
        !data.canManage &&
        `Only owners and admins can change what projects use ${name} for.`
      }
    >
      {data ? (
        <section className={styles.groups}>
          <SectionHeader
            title={`${data.definition.name} (${data.integration.name})`}
            description={spec?.description ?? data.definition.description}
          />
          {note ? <Banner tone={note.tone}>{note.text}</Banner> : null}
          {data.integration.needsAttention ? (
            <Banner
              tone="danger"
              title={`CirCI can’t reach ${data.integration.name}:`}
              action={
                data.canManage && data.configured && data.definition.oauth ? (
                  <Button
                    loading={install.isPending}
                    onClick={() => install.mutate(data.integration.kind)}
                    aria-label={`Reinstall ${data.integration.name}`}
                  >
                    Reinstall
                  </Button>
                ) : undefined
              }
            >
              {data.integration.attentionReason ??
                `${data.definition.name} no longer accepts the saved credentials.`}
            </Banner>
          ) : null}
          {install.error ? <Banner tone="danger">{install.error.message}</Banner> : null}
          {mapping.save.error ? <Banner tone="danger">{mapping.save.error.message}</Banner> : null}
          {mapping.clear.error ? (
            <Banner tone="danger">{mapping.clear.error.message}</Banner>
          ) : null}
          {spec === null ? (
            <EmptyState title="Nothing to set up">
              {data.definition.name} has no per-project settings.
            </EmptyState>
          ) : (
            <ul className={styles.list} aria-label={`${spec.targetLabel} by project`}>
              {data.projects.map((p) => (
                <li key={p.slug}>
                  <ProjectMapping
                    // Start over when the saved mapping changes (after saving, or removing it).
                    key={`${p.mapping?.ref ?? ''}:${JSON.stringify(p.mapping?.extra ?? {})}`}
                    org={org}
                    integrationId={id}
                    spec={spec}
                    project={p}
                    canManage={data.canManage}
                    saving={mapping.save.isPending}
                    onSave={(input) => mapping.save.mutate({ project: p.slug, ...input })}
                    onClear={() => mapping.clear.mutate(p.slug)}
                  />
                  {links && (p.mapping || data.canManage) ? (
                    <ProjectLinks
                      org={org}
                      integrationId={id}
                      spec={links}
                      project={p}
                      canManage={data.canManage}
                    />
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
    </Frame>
  )
}

function ProjectMapping(props: {
  org: string
  integrationId: string
  spec: Integration.MappingSpec
  project: Integration.MappingProject
  canManage: boolean
  saving: boolean
  onSave: (input: Integration.MappingInput) => void
  onClear: () => void
}) {
  const { spec, project } = props
  const saved = project.mapping
  const [ref, setRef] = useState(saved?.ref ?? '')
  const [values, setValues] = useState<ExtraValues>(() => initialExtra(spec.fields, saved?.extra))
  const selecting = spec.targetKind === 'select'
  const targets = useQuery({
    ...targetsQuery(props.org, props.integrationId),
    enabled: selecting && props.canManage,
  })
  const items = targetItems(
    targets.data?.targets ?? [],
    saved ? { ref: saved.ref, name: saved.name } : null,
  )
  const summary = saved ? mappingSummary(spec, saved.extra) : null
  const targetName = spec.targetLabel.toLowerCase()

  if (!props.canManage) {
    return (
      <ListRow density="two-line">
        <div className={styles.row}>
          <div className={styles.name}>
            <Text>{project.name}</Text>
            <Text variant="small" tone="secondary">
              {saved ? (summary ?? 'In use') : 'Not set up'}
            </Text>
          </div>
          <Text tone="secondary" variant="mono">
            {saved ? (saved.name ?? saved.ref) : '—'}
          </Text>
        </div>
      </ListRow>
    )
  }

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!canSave(spec, ref, values)) return
    const picked = items.find((i) => i.value === ref)
    if (selecting && !picked) return
    props.onSave({
      ref: ref.trim(),
      ...(picked ? { name: picked.name } : {}),
      extra: extraToSend(spec.fields, values),
    })
  }

  const setValue = (key: string, value: unknown) => setValues((cur) => ({ ...cur, [key]: value }))

  return (
    <ListRow density="two-line">
      <form onSubmit={submit} noValidate className={styles.form} aria-label={project.name}>
        {selecting ? (
          <Select
            className={styles.repoField}
            label={`${project.name} ${targetName}`}
            items={items}
            value={ref}
            placeholder={targets.isPending ? `Loading ${targetName}s…` : `Choose a ${targetName}`}
            onValueChange={setRef}
            {...(targets.error ? { error: targets.error.message } : {})}
          />
        ) : (
          <TextField
            label={`${project.name} ${targetName}`}
            value={ref}
            onChange={(e) => setRef(e.target.value)}
            {...(spec.targetPlaceholder ? { placeholder: spec.targetPlaceholder } : {})}
          />
        )}
        {spec.fields.map((field) => {
          if (field.kind === 'events') {
            const on = Array.isArray(values[field.key]) ? values[field.key] : []
            return (
              <div
                key={field.key}
                role="group"
                aria-label={`${project.name} ${field.label.toLowerCase()}`}
                className={styles.form}
              >
                {field.options.map((o) => (
                  <Checkbox
                    key={o.event}
                    label={o.label}
                    checked={Array.isArray(on) && on.includes(o.event)}
                    onCheckedChange={(checked) =>
                      setValue(
                        field.key,
                        field.options
                          .map((x) => x.event)
                          .filter((e) =>
                            e === o.event ? checked : Array.isArray(on) && on.includes(e),
                          ),
                      )
                    }
                  />
                ))}
              </div>
            )
          }
          if (field.kind === 'toggle') {
            return (
              <Checkbox
                key={field.key}
                label={field.label}
                checked={values[field.key] === true}
                onCheckedChange={(checked) => setValue(field.key, checked)}
              />
            )
          }
          return (
            <TextField
              key={field.key}
              label={`${project.name} ${field.label.toLowerCase()}`}
              value={typeof values[field.key] === 'string' ? String(values[field.key]) : ''}
              onChange={(e) => setValue(field.key, e.target.value)}
              required={!field.optional}
              {...(field.placeholder ? { placeholder: field.placeholder } : {})}
            />
          )
        })}
        <div className={styles.trailing}>
          <Button
            type="submit"
            variant="primary"
            loading={props.saving}
            disabled={!canSave(spec, ref, values)}
          >
            {saved ? 'Update' : 'Save'}
          </Button>
          {saved ? (
            <Button
              variant="danger"
              onClick={props.onClear}
              aria-label={`Remove ${project.name} ${targetName}`}
            >
              Remove
            </Button>
          ) : null}
        </div>
      </form>
    </ListRow>
  )
}
