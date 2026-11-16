import { Drawer, NavItem } from '@circi/ui'

/** Open over the card (the drawer is a portal: it follows the page's scheme, not a wrapper). */
export const Open = () => (
  <Drawer open onOpenChange={() => {}} title="Navigation">
    <div style={{ padding: '10px 8px', display: 'flex', flexDirection: 'column', gap: 1 }}>
      <div style={{ padding: '6px 8px 10px', fontWeight: 600 }}>acme</div>
      <NavItem href="#projects" selected>
        Projects
      </NavItem>
      <NavItem href="#members">Members</NavItem>
      <NavItem href="#settings">Settings</NavItem>
    </div>
  </Drawer>
)
