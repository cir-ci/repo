import { IconButton, Menu, SlidersIcon } from '@circi/ui'

/**
 * The viewer's "View options" menu, one on the desktop toolbar and on a phone: what a drag draws
 * (Comments or Ignore regions, a radio group), the checkerboard behind the screenshot (a
 * checkbox) and, on a phone, the entries only it has (`before` and `after`: the views and the zoom).
 */
export function ViewOptionsMenu({
  drawing,
  checkerboard,
  onCheckerboard,
  before = NONE,
  after = NONE,
}: ViewOptionsMenu.Props) {
  return (
    <Menu
      align="end"
      size="md"
      trigger={
        <IconButton label="View options">
          <SlidersIcon />
        </IconButton>
      }
      items={[
        ...before,
        ...(drawing
          ? [
              {
                type: 'radio-group' as const,
                name: 'Dragging draws',
                value: drawing.mode,
                onValueChange: (m: string) => {
                  if (m === 'comments' || m === 'ignore') drawing.onMode(m)
                },
                options: DRAW_OPTIONS,
                closeOnClick: true,
              },
              { type: 'separator' as const },
            ]
          : []),
        {
          type: 'checkbox' as const,
          label: 'Checkerboard',
          checked: checkerboard,
          onCheckedChange: onCheckerboard,
          closeOnClick: true,
        },
        ...after,
      ]}
    />
  )
}

const NONE: Menu.Entry[] = []

const DRAW_OPTIONS = [
  { value: 'comments', label: 'Comments' },
  { value: 'ignore', label: 'Ignore regions' },
]

export namespace ViewOptionsMenu {
  export interface Props {
    /** What a drag draws; absent where nobody can choose (ignore regions need a manager). */
    drawing?: { mode: 'comments' | 'ignore'; onMode: (mode: 'comments' | 'ignore') => void }
    checkerboard: boolean
    onCheckerboard: (on: boolean) => void
    /** Entries above the options (a phone's views). */
    before?: Menu.Entry[]
    /** Entries below them (a phone's zoom and ignore regions). */
    after?: Menu.Entry[]
  }
}
