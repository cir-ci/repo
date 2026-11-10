import { Checkbox, SettingsRow, SettingsSection } from '@circi/ui'

/**
 * What CirCI does on its own, per team. Controlled: `ReviewsForm` holds the draft and saves it
 * with the rest, so these are checkboxes (they wait for Save).
 */
export function AutomationSection(props: AutomationSection.Props) {
  const { disabled } = props
  return (
    <SettingsSection title="Automation">
      <SettingsRow>
        <Checkbox
          label="Close review requests when a newer build arrives on the same branch"
          description="The old request shows as superseded; nobody reviews a stale build."
          checked={props.close}
          onCheckedChange={props.onCloseChange}
          disabled={disabled}
        />
      </SettingsRow>
      <SettingsRow>
        <Checkbox
          label="Re-request the same reviewers on the newer build"
          description="Keeps the conversation with the people who already looked. Needs requests to close."
          checked={props.reRequest && props.close}
          onCheckedChange={props.onReRequestChange}
          disabled={disabled || !props.close}
        />
      </SettingsRow>
      <SettingsRow>
        <Checkbox
          label="Approve builds with no changes automatically"
          description="They pass the GitHub check without a review request."
          checked={props.autoApprove}
          onCheckedChange={props.onAutoApproveChange}
          disabled={disabled}
        />
      </SettingsRow>
      <SettingsRow>
        <Checkbox
          label="Ask for a reason when someone rejects"
          description="The reason goes to the author's Inbox and the pull request."
          checked={props.requireReason}
          onCheckedChange={props.onRequireReasonChange}
          disabled={disabled}
        />
      </SettingsRow>
    </SettingsSection>
  )
}

export namespace AutomationSection {
  export interface Props {
    close: boolean
    reRequest: boolean
    autoApprove: boolean
    requireReason: boolean
    disabled: boolean
    onCloseChange: (on: boolean) => void
    onReRequestChange: (on: boolean) => void
    onAutoApproveChange: (on: boolean) => void
    onRequireReasonChange: (on: boolean) => void
  }
}
