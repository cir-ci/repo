import type { Triage } from '@circi/api'
import {
  Banner,
  Button,
  Checkbox,
  CheckboxGroup,
  SectionHeader,
  Text,
  TextField,
  useAnnounce,
} from '@circi/ui'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { triageQuery } from '#features/triage/api.ts'
import { RelativeTime } from '#lib/RelativeTime.tsx'

import {
  rotationBody,
  rotationDirty,
  startDateOf,
  startDateProblem,
  toggleMember,
  useRuleActions,
} from './api.ts'

import styles from './Settings.module.css'

/** Who takes turns on triage, week by week, from a start date. An empty list turns it off. */
export function RotationSection(props: RotationSection.Props) {
  const { rotation: save } = useRuleActions(props.org, props.project)
  const { data: queue } = useQuery(triageQuery(props.org, props.project))
  const announce = useAnnounce()
  const [ids, setIds] = useState(() => props.rotation.members.map((m) => m.id))
  const [date, setDate] = useState(startDateOf(props.rotation))
  const [done, setDone] = useState(false)
  const problem = startDateProblem(date)
  const dirty = rotationDirty(props.rotation, ids, date)
  const onTriage = queue?.rotation.onTriage ?? null
  const disabled = !props.canManage

  return (
    <form
      className={styles.section}
      noValidate
      onSubmit={(e) => {
        e.preventDefault()
        if (problem) return
        setDone(false)
        save.mutate(rotationBody(ids, date), {
          onSuccess: () => {
            setDone(true)
            announce('Triage rotation saved')
          },
        })
      }}
    >
      <SectionHeader
        title="Triage rotation"
        description="One person at a time is on triage for the week and is the default owner of what turns up. People take turns in the order they were added."
      />
      <div className={styles.fields}>
        {onTriage ? (
          <Text>
            On triage this week: <strong>{onTriage.name}</strong>
            {queue?.rotation.until ? (
              <>
                {' '}
                (until <RelativeTime iso={queue.rotation.until} />)
              </>
            ) : null}
          </Text>
        ) : (
          <Text tone="secondary">No one is on triage: there is no rotation.</Text>
        )}
        <CheckboxGroup legend="People in the rotation" disabled={disabled}>
          {props.people.map((p) => (
            <Checkbox
              key={p.id}
              label={p.name}
              checked={ids.includes(p.id)}
              onCheckedChange={(on) => {
                setIds((current) => toggleMember(current, p.id, on))
                setDone(false)
              }}
              disabled={disabled}
            />
          ))}
        </CheckboxGroup>
        <TextField
          name="startsOn"
          label="First week starts"
          type="date"
          value={date}
          disabled={disabled || ids.length === 0}
          onChange={(e) => {
            setDate(e.target.value)
            setDone(false)
          }}
          error={problem ?? undefined}
          description="Any day in the first week. Leave empty to start now."
        />
        {save.error ? <Banner tone="danger">{save.error.message}</Banner> : null}
        {done && !dirty ? <Banner tone="success">Triage rotation saved.</Banner> : null}
        {props.canManage ? (
          <div className={styles.actions}>
            <Button type="submit" variant="primary" loading={save.isPending} disabled={!dirty}>
              {save.isPending ? 'Saving…' : 'Save rotation'}
            </Button>
          </div>
        ) : null}
      </div>
    </form>
  )
}

export namespace RotationSection {
  export interface Props {
    org: string
    project: string
    rotation: Triage.Rotation
    people: { id: string; name: string }[]
    canManage: boolean
  }
}
