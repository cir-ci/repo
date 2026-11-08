import { AppFrame, ListRow, NavItem, PanelHeader, StatusIcon } from '@circi/ui'

const meta = { fontSize: 12, opacity: 0.6 }

export const Dashboard = () => (
  <AppFrame
    minHeight={360}
    sidebar={
      <>
        <div style={{ padding: '6px 8px 10px', fontWeight: 600 }}>acme</div>
        <NavItem href="#teams" selected>
          Teams
        </NavItem>
        <NavItem href="#members">Members</NavItem>
        <NavItem href="#settings">Settings</NavItem>
      </>
    }
  >
    <PanelHeader>Teams</PanelHeader>
    <ListRow
      href="#web"
      leading={<StatusIcon status="needs-review" />}
      trailing={<span style={meta}>2m</span>}
    >
      web-app
    </ListRow>
    <ListRow
      href="#sb"
      leading={<StatusIcon status="approved" />}
      trailing={<span style={meta}>1h</span>}
    >
      storybook
    </ListRow>
    <ListRow
      href="#www"
      leading={<StatusIcon status="processing" />}
      trailing={<span style={meta}>now</span>}
    >
      marketing-site
    </ListRow>
  </AppFrame>
)
