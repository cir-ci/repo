import { FLAKY_MIN_CHANGES, FLAKY_WINDOW } from '@circi/core'
import { Checkbox, CheckboxGroup, SettingsRow, SettingsSection, Text, TextField } from '@circi/ui'
import { useQuery } from '@tanstack/react-query'

import { triageQuery } from '#features/triage/api.ts'
import { RelativeTime } from '#lib/RelativeTime.tsx'

import { startDateProblem, toggleMember } from './api.ts'

/**
 * Triage: who takes turns on the queue, week by week, from a start date (an empty list turns it
 * off), and what counts as flaky. Controlled: `ReviewsForm` holds the draft and saves it with the
 * rest.
 */
export function RotationSection(props: RotationSection.Props) {
  const { data: queue } = useQuery(triageQuery(props.workspace, props.team))
  const { ids, date, disabled } = props
  const onTriage = queue?.rotation.onTriage ?? null
  const problem = startDateProblem(date, props.dateUnreadable)

  return (
    <SettingsSection
      title="Triage"
      description="One person a week owns the triage queue: flaky snapshots, missing baselines, failed builds. People take turns in the order they were added."
    >
      <SettingsRow>
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
      </SettingsRow>
      <SettingsRow>
        <CheckboxGroup legend="People in the rotation" disabled={disabled}>
          {props.people.map((p) => (
            <Checkbox
              key={p.id}
              label={p.name}
              checked={ids.includes(p.id)}
              onCheckedChange={(on) => props.onIdsChange(toggleMember(ids, p.id, on))}
              disabled={disabled}
            />
          ))}
        </CheckboxGroup>
      </SettingsRow>
      <SettingsRow>
        <TextField
          name="startsOn"
          label="First week starts"
          type="date"
          value={date}
          disabled={disabled || ids.length === 0}
          onChange={(e) => props.onDateChange(e.target.value, e.target.validity.badInput)}
          // Typing a day that does not exist leaves the value empty and fires no change event.
          onBlur={(e) => props.onDateChange(e.target.value, e.target.validity.badInput)}
          error={problem ?? undefined}
          description="Any day in the first week. Leave empty to start now."
        />
      </SettingsRow>
      <SettingsRow
        label="Flag a snapshot as flaky"
        detail={`After ${FLAKY_MIN_CHANGES} changes in the last ${FLAKY_WINDOW} builds on the default branch. Fixed for every team.`}
      />
    </SettingsSection>
  )
}

export namespace RotationSection {
  export interface Props {
    workspace: string
    team: string
    people: { id: string; name: string }[]
    ids: string[]
    date: string
    disabled: boolean
    onIdsChange: (ids: string[]) => void
    /** The date input holds text that is not a date (its value is then empty). */
    dateUnreadable: boolean
    onDateChange: (date: string, unreadable: boolean) => void
  }
}
