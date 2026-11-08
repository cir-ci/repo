import * as icons from '../src/icons.ts'
import { Button, ColorSchemeControl, Dialog, TextField, tokens } from '../src/index.ts'

/**
 * Visual cases for the components that have no `.design-sync/previews` file. Each export is one
 * screenshot per colour scheme (see `ui.visual.test.tsx`), so keep them small and static.
 */

const Pad = (props: { children: React.ReactNode; width?: number }) => (
  <div
    style={{
      padding: 24,
      display: 'flex',
      flexDirection: 'column',
      gap: 12,
      background: tokens.surface.panel,
      color: tokens.text.primary,
      width: props.width,
    }}
  >
    {props.children}
  </div>
)

const ButtonVariants = () => (
  <Pad>
    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      <Button variant="primary">Approve</Button>
      <Button>Secondary</Button>
      <Button variant="danger">Reject</Button>
      <Button variant="ghost">Ghost</Button>
      <Button variant="link">Link</Button>
    </div>
    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      <Button variant="primary" size="sm">
        Approve
      </Button>
      <Button size="sm">Secondary</Button>
      <Button variant="danger" size="sm">
        Reject
      </Button>
      <Button variant="ghost" size="sm">
        Ghost
      </Button>
    </div>
  </Pad>
)

const ButtonStates = () => (
  <Pad>
    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      <Button disabled>Disabled</Button>
      <Button variant="primary" disabled>
        Disabled
      </Button>
      <Button variant="primary" loading>
        Saving
      </Button>
      <Button href="#anchor">As a link</Button>
    </div>
  </Pad>
)

const TextFieldStates = () => (
  <Pad width={360}>
    <TextField label="Project name" defaultValue="web-app" description="Shown in the dashboard." />
    <TextField label="Slug" defaultValue="Web App" error="Use lowercase letters and dashes." />
    <TextField label="Token" placeholder="Paste a token" disabled />
  </Pad>
)

const ColorSchemeSwitch = () => (
  <Pad>
    <ColorSchemeControl />
  </Pad>
)

/** Open over the page (a portal: it follows the scheme on `<html>`). */
const DialogOpen = () => (
  <Dialog
    open
    onOpenChange={() => {}}
    title="Rename project"
    description="The slug in URLs stays the same."
    actions={
      <>
        <Button>Cancel</Button>
        <Button variant="primary">Rename</Button>
      </>
    }
  >
    <TextField label="Name" defaultValue="web-app" />
  </Dialog>
)

/** Every icon wrapper, so a changed or missing glyph shows up. */
const IconSheet = () => (
  <Pad width={560}>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
      {Object.entries(icons).map(([name, Icon]) =>
        typeof Icon === 'function' || typeof Icon === 'object' ? (
          <Icon key={name} aria-hidden="true" />
        ) : null,
      )}
    </div>
  </Pad>
)

/** Component name, then case name, then the case. */
export const extraCases: Record<string, Record<string, () => React.JSX.Element>> = {
  Button: { Variants: ButtonVariants, States: ButtonStates },
  TextField: { States: TextFieldStates },
  ColorSchemeControl: { Switch: ColorSchemeSwitch },
  Dialog: { Open: DialogOpen },
  icons: { Sheet: IconSheet },
}
