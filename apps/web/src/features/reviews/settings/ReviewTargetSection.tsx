import { Checkbox, NumberField, SettingsRow, SettingsSection } from '@circi/ui'

import { numberOf, textOf } from '#lib/number-field.ts'

import { targetProblem } from './api.ts'

/**
 * How long a review request may wait. Controlled: `ReviewsForm` holds the draft and saves it with
 * the rest.
 */
export function ReviewTargetSection(props: ReviewTargetSection.Props) {
  const { saved, enabled, hours, touched, disabled } = props
  const problem = enabled ? targetProblem(hours) : null
  return (
    <SettingsSection
      title="Review target"
      description={
        saved === null
          ? 'Review requests never become overdue. Set a target and requests waiting longer get an overdue badge in Reviews and notify the reviewer.'
          : `Requests waiting longer than this get an overdue badge in Reviews and a reminder in the reviewer’s Inbox.`
      }
    >
      <SettingsRow>
        <Checkbox
          label="Set a review target"
          checked={enabled}
          onCheckedChange={props.onEnabledChange}
          disabled={disabled}
        />
      </SettingsRow>
      {enabled ? (
        <SettingsRow label="Target">
          <NumberField
            className={props.className}
            name="reviewTargetHours"
            label="Overdue after (hours)"
            hideLabel
            unit="hours"
            step={1}
            value={numberOf(hours)}
            disabled={disabled}
            onValueChange={(next) => props.onHoursChange(textOf(next))}
            error={(touched && problem ? problem : undefined) ?? props.serverProblem}
          />
        </SettingsRow>
      ) : null}
    </SettingsSection>
  )
}

export namespace ReviewTargetSection {
  export interface Props {
    /** The saved hours; null means no target. */
    saved: number | null
    enabled: boolean
    hours: string
    /** Show the problem with the hours (after a first try to save). */
    touched: boolean
    /** What the server said about the hours, when it says which field. */
    serverProblem?: string | undefined
    disabled: boolean
    onEnabledChange: (enabled: boolean) => void
    onHoursChange: (hours: string) => void
    /** The class that lays the number and its unit out. */
    className?: string
  }
}
