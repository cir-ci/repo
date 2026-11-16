import { Kbd, NavItem, StatusIcon } from '@circi/ui'

export const Nested = () => (
  <div style={{ width: 228, display: 'flex', flexDirection: 'column', gap: 1, padding: 12 }}>
    <NavItem href="#web-app">web-app</NavItem>
    <NavItem href="#builds" sub selected>
      Builds
    </NavItem>
    <NavItem href="#triage" sub count={3}>
      Triage
    </NavItem>
  </div>
)

export const Sidebar = () => (
  <div style={{ width: 228, display: 'flex', flexDirection: 'column', gap: 1, padding: 12 }}>
    <NavItem href="#search" trailing={<Kbd>⌘K</Kbd>}>
      Search
    </NavItem>
    <NavItem href="#projects" selected>
      Projects
    </NavItem>
    <NavItem href="#members">Members</NavItem>
    <NavItem href="#settings">Settings</NavItem>
    <div style={{ padding: '14px 10px 4px', fontSize: 13, fontWeight: 500, opacity: 0.7 }}>
      Projects
    </div>
    <NavItem href="#web-app" trailing={<StatusIcon status="needs-review" size={10} />}>
      web-app
    </NavItem>
    <NavItem href="#storybook">storybook</NavItem>
    <NavItem href="#marketing-site">marketing-site</NavItem>
  </div>
)
