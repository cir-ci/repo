import {
  Badge,
  Button,
  COLOR_SCHEME_ATTRIBUTE,
  SettingsPage,
  SettingsRow,
  SettingsSection,
  SettingsSummary,
  Switch,
  tokens,
} from '@circi/ui'
import type { ReactNode } from 'react'

/** The same content in both schemes: any subtree can be pinned with the attribute. */
const Both = (props: { children: ReactNode; width?: number }) => (
  <div style={{ display: 'flex', flexDirection: 'column' }}>
    {(['dark', 'light'] as const).map((scheme) => (
      <div
        key={scheme}
        {...{ [COLOR_SCHEME_ATTRIBUTE]: scheme }}
        style={{
          background: tokens.surface.panel,
          color: tokens.text.primary,
          fontSize: 13,
          width: props.width,
        }}
      >
        {props.children}
      </div>
    ))}
  </div>
)

export const Column = () => (
  <Both width={760}>
    <SettingsPage
      title="Instance settings"
      description="These come from the server's environment, so they are shown here to check, not to edit."
      actions={<Button size="sm">Run checks again</Button>}
    >
      <SettingsSection title="Dashboard address" description="Every link CirCI sends uses it.">
        <SettingsRow value="https://ci.acme.io" env="PUBLIC_URL" />
        <SettingsRow
          label="Google"
          detail="Not configured on this server."
          env="AUTH_GOOGLE_CLIENT_ID"
          status={
            <Badge shape="tag" tone="neutral">
              Off
            </Badge>
          }
        />
        <SettingsRow label="Flaky screenshots block merges" detail="Applies to every team.">
          <Switch label="On" defaultChecked />
        </SettingsRow>
      </SettingsSection>
      <SettingsSection title="Danger zone" tone="danger">
        <SettingsRow label="Delete workspace" detail="Deletes its teams, builds and sites.">
          <Button variant="danger">Delete workspace</Button>
        </SettingsRow>
      </SettingsSection>
    </SettingsPage>
  </Both>
)

export const Health = () => (
  <Both width={760}>
    <SettingsPage title="Health">
      <SettingsSection title="Summary" bare>
        <SettingsSummary
          items={[
            {
              label: 'Passing',
              value: 4,
              extra: (
                <Badge shape="tag" tone="state" state="approved">
                  Passing
                </Badge>
              ),
            },
            {
              label: 'Need a look',
              value: 2,
              extra: (
                <Badge shape="tag" tone="state" state="review">
                  Check
                </Badge>
              ),
            },
            { label: 'Oldest waiting', value: '42 s', extra: 'diff · web-app #148' },
          ]}
        />
      </SettingsSection>
      <SettingsSection title="Moving to ci.acme.io">
        <SettingsRow
          leading="1"
          label="Keep the old address answering"
          detail="DNS and the certificate still point at CirCI."
          value="circi.acme.dev"
          status={
            <Badge shape="tag" tone="state" state="approved">
              Done
            </Badge>
          }
        />
        <SettingsRow
          leading="2"
          label="Change the GitHub app callback"
          detail="In the app settings on GitHub."
          status={
            <Badge shape="tag" tone="neutral">
              To do
            </Badge>
          }
        />
      </SettingsSection>
    </SettingsPage>
  </Both>
)

export const Narrow = () => (
  <Both width={360}>
    <SettingsPage title="Health">
      <SettingsSection title="Services">
        <SettingsRow
          label="Storage"
          detail="Local disk, writable."
          value="/var/lib/circi/files · 412 GB free"
          status={
            <Badge shape="tag" tone="state" state="approved">
              Passing
            </Badge>
          }
        />
      </SettingsSection>
    </SettingsPage>
  </Both>
)
