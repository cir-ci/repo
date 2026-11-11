import { FLAKY_WINDOW } from '@circi/core'
import {
  Avatar,
  Checkbox,
  CheckboxGroup,
  NumberField,
  Select,
  SettingsRow,
  SettingsSection,
  Text,
  TextField,
} from '@circi/ui'
import { Fragment } from 'react'

import {
  flakyChoices,
  type FlakyChoice,
  isFlakyChoice,
} from '#features/project-settings/flaky-setting.ts'
import { numberOf, textOf } from '#lib/number-field.ts'

import {
  dayCount,
  flakyProblem,
  type Person,
  SNOOZE_DAY_CHOICES,
  startDateProblem,
  toggleMember,
} from './api.ts'

import styles from './ReviewsSettings.module.css'

/**
 * Triage: who takes turns on the queue, week by week, from a start date (an empty list turns it
 * off), when a screenshot counts as flaky and how long a snoozed item stays away. Controlled:
 * `ReviewsForm` holds the draft and saves it with the rest.
 */
export function RotationSection(props: RotationSection.Props) {
  const { ids, date, disabled } = props
  const problem = startDateProblem(date, props.dateUnreadable)
  const flaky = flakyProblem(props.flakyAfter)
  // The saved rotation names its people itself: use it while the project's member list is loading,
  // so the row never says "no rotation" for a moment when there is one.
  const inRotation = ids.flatMap(
    (id) => props.people.find((p) => p.id === id) ?? props.known.find((p) => p.id === id) ?? [],
  )
  const days = Number(props.snoozeDays)
  const dayItems = [...new Set([...SNOOZE_DAY_CHOICES, ...(Number.isInteger(days) ? [days] : [])])]
    .toSorted((a, b) => a - b)
    .map((d) => ({ value: String(d), label: dayCount(d) }))

  return (
    <SettingsSection
      title="Triage"
      description={`One of ${props.projectName}'s members a week owns the triage queue: flaky screenshots, missing baselines, failed builds.`}
    >
      <SettingsRow label="Rotation">
        {inRotation.length > 0 ? (
          <div className={styles.chain}>
            {inRotation.map((p, i) => (
              <Fragment key={p.id}>
                {i > 0 ? (
                  <span className={styles.arrow} aria-hidden="true">
                    →
                  </span>
                ) : null}
                <span className={styles.person}>
                  <Avatar type="user" id={p.id} name={p.name} image={p.image ?? null} />
                  {p.name}
                </span>
              </Fragment>
            ))}
            <Text variant="small" tone="secondary">
              · weekly, Mondays
            </Text>
          </div>
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
      <SettingsRow id="assign-on-call">
        <Select
          label="Assign new items to whoever is on triage"
          description="Items nobody has are assigned to them, and move to the next person at the handover. Items someone assigns or unassigns stay as they left them."
          items={flakyChoices(props.workspaceAssignOnCall)}
          value={props.assignOnCall}
          disabled={disabled}
          onValueChange={(next) => {
            if (isFlakyChoice(next)) props.onAssignOnCallChange(next)
          }}
        />
      </SettingsRow>
      <SettingsRow label="Flag a screenshot as flaky after">
        <div className={styles.inline}>
          <NumberField
            className={styles.small}
            name="flakyAfterChanges"
            label="Returns to an earlier image before flaky"
            hideLabel
            step={1}
            value={numberOf(props.flakyAfter)}
            disabled={disabled}
            onValueChange={(next) => props.onFlakyChange(textOf(next))}
            error={(props.touched && flaky ? flaky : undefined) ?? props.serverFlakyProblem}
          />
          <Text>
            returns to an earlier image in the last {FLAKY_WINDOW} commits on {props.defaultBranch}
          </Text>
        </div>
      </SettingsRow>
      <SettingsRow label="Snoozed items come back after">
        <Select
          label="Snoozed items come back after"
          hideLabel
          items={dayItems}
          value={props.snoozeDays}
          disabled={disabled}
          onValueChange={props.onSnoozeChange}
        />
      </SettingsRow>
    </SettingsSection>
  )
}

export namespace RotationSection {
  export interface Props {
    projectName: string
    defaultBranch: string
    people: Person[]
    /** The saved rotation's people, with their names and pictures (the rotation answer carries them). */
    known: Person[]
    ids: string[]
    date: string
    flakyAfter: string
    snoozeDays: string
    assignOnCall: FlakyChoice
    /** What `inherit` means for this project: the workspace's default. */
    workspaceAssignOnCall: boolean
    /** Show the problems with the typed values (after a first try to save). */
    touched: boolean
    serverFlakyProblem?: string | undefined
    disabled: boolean
    onIdsChange: (ids: string[]) => void
    /** The date input holds text that is not a date (its value is then empty). */
    dateUnreadable: boolean
    onDateChange: (date: string, unreadable: boolean) => void
    onFlakyChange: (changes: string) => void
    onSnoozeChange: (days: string) => void
    onAssignOnCallChange: (choice: FlakyChoice) => void
  }
}
