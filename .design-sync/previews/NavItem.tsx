import { Kbd, NavItem, StatusIcon } from '@circi/ui'

export const Sidebar = () => (
  <div style={{ width: 228, display: 'flex', flexDirection: 'column', gap: 1, padding: 12 }}>
    <NavItem href="#search" trailing={<Kbd>⌘K</Kbd>}>
      Search
    </NavItem>
    <NavItem href="#teams" selected>
      Teams
    </NavItem>
    <NavItem href="#members">Members</NavItem>
    <NavItem href="#settings">Settings</NavItem>
    <div style={{ padding: '14px 8px 4px', fontSize: 11, fontWeight: 500, opacity: 0.6 }}>
      Teams
    </div>
    <NavItem href="#web-app" trailing={<StatusIcon status="needs-review" size={10} />}>
      web-app
    </NavItem>
    <NavItem href="#storybook">storybook</NavItem>
    <NavItem href="#marketing-site">marketing-site</NavItem>
  </div>
)
