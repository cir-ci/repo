import type { Team } from '@circi/api'
import { Banner, Button, Checkbox, SectionHeader, Switch, TextField, useAnnounce } from '@circi/ui'
import { useState } from 'react'

import { useSaveSettings } from '#features/teams/api/index.ts'

import { describeHours, targetDirty, targetProblem, targetText, targetValue } from './api.ts'

import styles from './Settings.module.css'

/** How long a review request may wait, and the (fixed) rule that a newer build closes older requests. */
export function ReviewTargetSection(props: ReviewTargetSection.Props) {
  const save = useSaveSettings(props.workspace, props.team)
  const announce = useAnnounce()
  const saved = props.settings.reviewTargetHours
  const [enabled, setEnabled] = useState(saved !== null)
  const [hours, setHours] = useState(targetText(saved))
  const [touched, setTouched] = useState(false)
  const [done, setDone] = useState(false)
  const problem = enabled ? targetProblem(hours) : null
  const dirty = targetDirty(saved, enabled, hours)
  const disabled = !props.canManage

  return (
    <form
      className={styles.section}
      noValidate
      onSubmit={(e) => {
        e.preventDefault()
        setTouched(true)
        if (problem) return
        setDone(false)
        save.mutate(
          { reviewTargetHours: targetValue(enabled, hours) },
          {
            onSuccess: () => {
              setDone(true)
              announce('Review target saved')
            },
          },
        )
      }}
    >
      <SectionHeader
        title="Review target"
        description={
          saved === null
            ? 'Review requests never become overdue.'
            : `A review request is overdue after ${describeHours(saved)}.`
        }
      />
      <div className={styles.fields}>
        <Checkbox
          label="Set a review target"
          description="Overdue requests are flagged in Reviews and notify the reviewer."
          checked={enabled}
          onCheckedChange={(on) => {
            setEnabled(on)
            setDone(false)
          }}
          disabled={disabled}
        />
        {enabled ? (
          <TextField
            name="reviewTargetHours"
            label="Overdue after (hours)"
            type="number"
            min={1}
            step={1}
            value={hours}
            disabled={disabled}
            onChange={(e) => {
              setHours(e.target.value)
              setDone(false)
            }}
            error={touched && problem ? problem : undefined}
          />
        ) : null}
        <Switch
          label="Close superseded review requests"
          description="Always on: when a newer build replaces one on the same branch, the older build’s review requests close."
          checked
          disabled
        />
        {save.error ? <Banner tone="danger">{save.error.message}</Banner> : null}
        {done && !dirty ? <Banner tone="success">Review target saved.</Banner> : null}
        {props.canManage ? (
          <div className={styles.actions}>
            <Button type="submit" variant="primary" loading={save.isPending} disabled={!dirty}>
              {save.isPending ? 'Saving…' : 'Save review target'}
            </Button>
          </div>
        ) : null}
      </div>
    </form>
  )
}

export namespace ReviewTargetSection {
  export interface Props {
    workspace: string
    team: string
    settings: Pick<Team.Settings, 'reviewTargetHours'>
    canManage: boolean
  }
}
