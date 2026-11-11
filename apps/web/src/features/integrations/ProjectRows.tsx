import type { Integration } from '@circi/api'
import { Button, Checkbox, Select, Text, TextField } from '@circi/ui'
import { useQuery } from '@tanstack/react-query'
import { type FormEvent, type ReactNode, useState } from 'react'

import {
  canSave,
  type ExtraValues,
  extraToSend,
  initialExtra,
  isDirty,
  mappingSummary,
  targetItems,
  targetsQuery,
} from './api/generic.ts'

import styles from './Integrations.module.css'

/**
 * One project of a non-git integration (a Slack channel, a Linear team, a Jira project, a Figma
 * file): the project, a picker (or a typed address) for its target, and the integration's settings
 * under it: event checkboxes, switches and text. Save appears once something changed; Remove
 * once something is saved. Without permission it reads as a plain row.
 */
export function ProjectRow(props: ProjectRow.Props) {
  const { spec, project } = props
  const saved = project.mapping
  const [ref, setRef] = useState(saved?.ref ?? '')
  const [values, setValues] = useState<ExtraValues>(() => initialExtra(spec.fields, saved?.extra))
  const selecting = spec.targetKind === 'select'
  const targets = useQuery({
    ...targetsQuery(props.workspace, props.integrationId),
    enabled: selecting && props.canManage,
  })
  const items = targetItems(
    targets.data?.targets ?? [],
    saved ? { ref: saved.ref, name: saved.name } : null,
  )
  const targetName = spec.targetLabel.toLowerCase()
  const dirty = isDirty(spec, saved, ref, values)

  if (!props.canManage) {
    return (
      <div className={styles.row}>
        <span className={styles.projectName}>
          {props.mark}
          <Text>{project.name}</Text>
        </span>
        <Text variant="small" tone="secondary">
          {saved ? (mappingSummary(spec, saved.extra) ?? 'In use') : 'Not set up'}
        </Text>
        <Text tone="secondary" variant="mono">
          {saved ? (saved.name ?? saved.ref) : '—'}
        </Text>
      </div>
    )
  }

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!dirty || !canSave(spec, ref, values)) return
    const picked = items.find((i) => i.value === ref)
    if (selecting && !picked) return
    props.onSave({
      ref: ref.trim(),
      ...(picked ? { name: picked.name } : {}),
      extra: extraToSend(spec.fields, values),
    })
  }

  const setValue = (key: string, value: unknown) => setValues((cur) => ({ ...cur, [key]: value }))
  const settings = spec.fields.map((field) => {
    if (field.kind === 'events') {
      const on = Array.isArray(values[field.key]) ? values[field.key] : []
      return (
        <div
          key={field.key}
          role="group"
          aria-label={`${project.name} ${field.label.toLowerCase()}`}
          className={styles.extras}
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
                    .filter((e) => (e === o.event ? checked : Array.isArray(on) && on.includes(e))),
                )
              }
            />
          ))}
        </div>
      )
    }
    if (field.kind === 'toggle') {
      return (
        <div key={field.key} className={styles.extras}>
          <Checkbox
            label={field.label}
            checked={values[field.key] === true}
            onCheckedChange={(checked) => setValue(field.key, checked)}
          />
        </div>
      )
    }
    return (
      <div key={field.key} className={styles.extras}>
        <TextField
          label={`${project.name} ${field.label.toLowerCase()}`}
          value={typeof values[field.key] === 'string' ? String(values[field.key]) : ''}
          onChange={(e) => setValue(field.key, e.target.value)}
          required={!field.optional}
          {...(field.placeholder ? { placeholder: field.placeholder } : {})}
        />
      </div>
    )
  })

  return (
    <form onSubmit={submit} noValidate aria-label={project.name}>
      <div className={styles.row}>
        <span className={styles.projectName}>
          {props.mark}
          <Text>{project.name}</Text>
        </span>
        {selecting ? (
          <Select
            className={styles.picker}
            label={`${project.name} ${targetName}`}
            hideLabel
            items={items}
            value={ref}
            placeholder={targets.isPending ? `Loading ${targetName}s…` : 'Not set'}
            onValueChange={setRef}
            {...(targets.error ? { error: targets.error.message } : {})}
          />
        ) : (
          <TextField
            className={styles.picker}
            label={`${project.name} ${targetName}`}
            hideLabel
            value={ref}
            onChange={(e) => setRef(e.target.value)}
            {...(spec.targetPlaceholder ? { placeholder: spec.targetPlaceholder } : {})}
          />
        )}
        <div className={styles.trailing}>
          {dirty ? (
            <Button type="submit" loading={props.saving} disabled={!canSave(spec, ref, values)}>
              {saved ? 'Update' : 'Save'}
            </Button>
          ) : null}
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
      </div>
      {settings}
    </form>
  )
}

export namespace ProjectRow {
  export interface Props {
    workspace: string
    integrationId: string
    spec: Integration.MappingSpec
    project: Integration.MappingProject
    canManage: boolean
    saving: boolean
    mark: ReactNode
    onSave: (input: Integration.MappingInput) => void
    onClear: () => void
  }
}
