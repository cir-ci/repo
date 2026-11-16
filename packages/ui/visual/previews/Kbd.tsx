import { Kbd } from '@circi/ui'

export const Shortcuts = () => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 24, fontSize: 13 }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      Search anywhere <Kbd>⌘K</Kbd>
    </div>
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      Next / previous snapshot <Kbd>J</Kbd> <Kbd>K</Kbd>
    </div>
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      Approve snapshot <Kbd>A</Kbd>
    </div>
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      Approve all <Kbd>⇧A</Kbd>
    </div>
  </div>
)
