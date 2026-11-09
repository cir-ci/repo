import { Checkbox, SettingsRow, SettingsSection, Text, TextField } from '@circi/ui'

import { describeHours, targetProblem } from './api.ts'

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
          : `Requests waiting longer than this get an overdue badge in Reviews and a reminder in the reviewer’s Inbox. Now: ${describeHours(saved)}.`
      }
    >
      <SettingsRow>
        <Checkbox
          label="Set a review target"
          description="Overdue requests are flagged in Reviews and notify the reviewer."
          checked={enabled}
          onCheckedChange={props.onEnabledChange}
          disabled={disabled}
        />
      </SettingsRow>
      {enabled ? (
        <SettingsRow label="Target">
          <div className={props.className}>
            <TextField
              name="reviewTargetHours"
              label="Overdue after (hours)"
              hideLabel
              type="number"
              min={1}
              step={1}
              value={hours}
              disabled={disabled}
              onChange={(e) => props.onHoursChange(e.target.value)}
              error={touched && problem ? problem : undefined}
            />
            <Text tone="secondary">hours</Text>
          </div>
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
    disabled: boolean
    onEnabledChange: (enabled: boolean) => void
    onHoursChange: (hours: string) => void
    /** The class that lays the number and its unit out. */
    className?: string
  }
}
