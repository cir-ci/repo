import { NumberField, Select, SettingsRow, SettingsSection, Text } from '@circi/ui'

import { numberOf, textOf } from '#lib/number-field.ts'

import { overdueExample, type Person, targetProblem } from './api.ts'

import styles from './ReviewsSettings.module.css'

const NOBODY = '__nobody__'

/**
 * How long a review request may wait, counting working days, and who else hears when it is
 * missed. Controlled: `ReviewsForm` holds the draft and saves it with the rest. An empty number
 * means no target.
 */
export function ReviewTargetSection(props: ReviewTargetSection.Props) {
  const { hours, touched, disabled } = props
  const problem = hours.trim() === '' ? null : targetProblem(hours)
  const example = overdueExample(hours)
  const items = [
    { value: NOBODY, label: 'Nobody' },
    ...props.people.map((p) => ({ value: p.id, label: p.name })),
  ]
  return (
    <SettingsSection
      title="Review target"
      description="Requests waiting longer than this get an overdue badge in Reviews and a reminder in the reviewer's Inbox."
    >
      <SettingsRow>
        <div className={styles.pair}>
          <NumberField
            className={props.className}
            name="reviewTargetHours"
            label="Overdue after (hours)"
            unit="hours"
            step={1}
            value={numberOf(hours)}
            disabled={disabled}
            inputProps={{ placeholder: 'No target' }}
            onValueChange={(next) => props.onHoursChange(textOf(next))}
            description={
              hours.trim() === ''
                ? 'No target: requests never become overdue.'
                : 'Counting working days.'
            }
            error={(touched && problem ? problem : undefined) ?? props.serverProblem}
          />
          <Select
            label="When it's missed, also tell"
            items={items}
            value={props.notifyUserId === '' ? NOBODY : props.notifyUserId}
            disabled={disabled}
            onValueChange={(next) => props.onNotifyChange(next === NOBODY ? '' : next)}
            error={props.notifyProblem}
          />
        </div>
      </SettingsRow>
      {example ? (
        <SettingsRow>
          <Text variant="small" tone="secondary">
            {example}
          </Text>
        </SettingsRow>
      ) : null}
    </SettingsSection>
  )
}

export namespace ReviewTargetSection {
  export interface Props {
    /** The hours as typed; empty means no target. */
    hours: string
    /** The member also told when a request misses its target; '' for nobody. */
    notifyUserId: string
    people: Person[]
    /** Show the problem with the hours (after a first try to save). */
    touched: boolean
    /** What the server said about the hours, when it says which field. */
    serverProblem?: string | undefined
    notifyProblem?: string | undefined
    disabled: boolean
    onHoursChange: (hours: string) => void
    onNotifyChange: (userId: string) => void
    /** The class that lays the number and its unit out. */
    className?: string
  }
}
