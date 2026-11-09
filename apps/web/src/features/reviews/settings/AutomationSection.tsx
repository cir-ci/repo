import { SettingsRow, SettingsSection, Switch } from '@circi/ui'

/**
 * What CirCI does on its own. Both are fixed behaviours, not settings: they are shown on (and
 * can't be turned off) so the page says what happens.
 */
export function AutomationSection() {
  return (
    <SettingsSection title="Automation" description="Always on for every team.">
      <SettingsRow>
        <Switch
          label="Close review requests when a newer build arrives on the same branch"
          description="The old request shows as superseded; nobody reviews a stale build."
          checked
          disabled
        />
      </SettingsRow>
      <SettingsRow>
        <Switch
          label="Approve builds with no changes automatically"
          description="They pass the GitHub check without a review request."
          checked
          disabled
        />
      </SettingsRow>
    </SettingsSection>
  )
}
