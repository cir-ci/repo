import { SettingsRow, SettingsSection, Text } from '@circi/ui'

/**
 * What CirCI does on its own. Both are fixed behaviours, not settings: they are listed as facts
 * (not as switches, which would suggest they can be changed) so the page says what happens.
 */
export function AutomationSection() {
  return (
    <SettingsSection title="Automation" description="Always on for every team.">
      <SettingsRow
        label="Close review requests when a newer build arrives on the same branch"
        detail="The old request shows as superseded; nobody reviews a stale build."
      >
        <Text tone="secondary">Always on</Text>
      </SettingsRow>
      <SettingsRow
        label="Approve builds with no changes automatically"
        detail="They pass the GitHub check without a review request."
      >
        <Text tone="secondary">Always on</Text>
      </SettingsRow>
    </SettingsSection>
  )
}
