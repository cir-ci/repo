import * as icons from '#src/icons.ts'
import {
  Button,
  ColorSchemeControl,
  Dialog,
  EnlargeTrigger,
  ImageDialog,
  TextField,
  tokens,
} from '#src/index.ts'

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
      <Button variant="toggle">Toggle</Button>
      <Button variant="toggle" defaultPressed>
        Toggle on
      </Button>
      <Button variant="filter">Filter</Button>
      <Button variant="filter" defaultPressed>
        Filter on
      </Button>
      <Button variant="select-trigger">main</Button>
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

const SHOT = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="960"><rect width="1280" height="960" fill="#fff"/><rect x="80" y="60" width="700" height="60" rx="8" fill="#111827"/><rect x="80" y="160" width="1000" height="30" rx="6" fill="#e5e7eb"/><rect x="80" y="260" width="1120" height="560" rx="12" fill="none" stroke="#e5e7eb" stroke-width="4"/><rect x="140" y="320" width="1000" height="90" rx="8" fill="none" stroke="#d1d5db" stroke-width="4"/><rect x="140" y="460" width="1000" height="90" rx="8" fill="none" stroke="#d1d5db" stroke-width="4"/><rect x="140" y="680" width="420" height="80" rx="40" fill="#1d4ed8"/></svg>',
)}`

/** Open over the page: the enlarged image with its caption and the switch between two images. */
const ImageDialogOpen = () => (
  <ImageDialog
    open
    index={1}
    onIndexChange={() => {}}
    onOpenChange={() => {}}
    images={[
      { src: SHOT, caption: 'Baseline · build #1 on main' },
      { src: SHOT, caption: 'This build · a0f30cf' },
    ]}
  />
)

/** The image as a trigger: the "Enlarge" chip shows on keyboard focus. */
const EnlargeTriggerFocused = () => (
  <Pad width={360}>
    <EnlargeTrigger label="Enlarge this build" autoFocus>
      <img src={SHOT} alt="" style={{ display: 'block', width: '100%' }} />
    </EnlargeTrigger>
  </Pad>
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
  ImageDialog: { Open: ImageDialogOpen, Trigger: EnlargeTriggerFocused },
  icons: { Sheet: IconSheet },
}
