import {
  Button,
  CheckIcon,
  ExpandLessIcon,
  ExpandMoreIcon,
  IconButton,
  Menu,
  RowMenuIcon,
  SegmentedControl,
  SquareDashedIcon,
  Text,
} from '@circi/ui'

import type { ViewMode } from './search.ts'
import type { Zoom } from './zoom.ts'

import styles from './ViewerPhone.module.css'

/** The four views a phone offers (canvas: Phone, the build page); Overlay and Side by side are in the options menu. */
export type PhoneView = 'new' | 'baseline' | 'diff' | 'slider'

const PHONE_VIEWS: readonly { value: PhoneView; label: string }[] = [
  { value: 'new', label: 'New' },
  { value: 'baseline', label: 'Baseline' },
  { value: 'diff', label: 'Diff' },
  { value: 'slider', label: 'Slider' },
]

/**
 * The viewer's controls on a phone, in place of the desktop toolbar's: the four views as a 40px
 * segmented control, Previous and Next screenshot, the Draw button (comment regions, see
 * `Viewer`) and an options menu with Overlay, Side by side, the checkerboard, the zoom and the
 * ignore regions (view only here). Every target is 44px. While drawing, a strip says how and Done
 * leaves draw mode.
 */
export function PhoneControls({
  view,
  hasBase,
  hasHead,
  comparable,
  onView,
  onPrevious,
  onNext,
  canDraw,
  drawing,
  onDrawing,
  checkerboard,
  onCheckerboard,
  zoom,
  onZoom,
  ignoreCount,
  showIgnore,
  onShowIgnore,
}: PhoneControls.Props) {
  const options = PHONE_VIEWS.filter(
    (o) =>
      (o.value === 'new' && hasHead) ||
      (o.value === 'baseline' && hasBase) ||
      ((o.value === 'diff' || o.value === 'slider') && comparable),
  )
  return (
    <div className={styles.root}>
      <div className={styles.row}>
        {options.length > 1 ? (
          <SegmentedControl
            label="View"
            options={options}
            value={view ?? ''}
            onChange={(v) => {
              const picked = PHONE_VIEWS.find((o) => o.value === v)
              if (picked) onView(picked.value)
            }}
          />
        ) : (
          <span className={styles.spacer} />
        )}
        <IconButton label="Previous screenshot" disabled={!onPrevious} onClick={onPrevious}>
          <ExpandLessIcon />
        </IconButton>
        <IconButton label="Next screenshot" disabled={!onNext} onClick={onNext}>
          <ExpandMoreIcon />
        </IconButton>
        {canDraw ? (
          <IconButton
            label="Draw a region"
            aria-pressed={drawing}
            className={styles.draw}
            onClick={() => onDrawing(!drawing)}
          >
            <SquareDashedIcon />
          </IconButton>
        ) : null}
        <Menu
          align="end"
          size="md"
          trigger={
            <IconButton label="View options">
              <RowMenuIcon />
            </IconButton>
          }
          items={[
            { label: 'Side by side', current: view === null, onSelect: () => onView('side') },
            ...(comparable
              ? [{ label: 'Overlay', current: false, onSelect: () => onView('overlay') }]
              : []),
            { type: 'separator' as const },
            {
              label: 'Checkerboard',
              trailing: checkerboard ? <CheckIcon size={14} /> : undefined,
              onSelect: () => onCheckerboard(!checkerboard),
            },
            {
              label: 'Fit to screen',
              trailing: zoom === 'fit' ? <CheckIcon size={14} /> : undefined,
              onSelect: () => onZoom('fit'),
            },
            {
              label: 'Actual size',
              trailing: zoom === 100 ? <CheckIcon size={14} /> : undefined,
              onSelect: () => onZoom(100),
            },
            ...(ignoreCount > 0
              ? [
                  { type: 'separator' as const },
                  {
                    label: 'Show ignore regions',
                    trailing: showIgnore ? <CheckIcon size={14} /> : undefined,
                    onSelect: () => onShowIgnore(!showIgnore),
                  },
                ]
              : []),
          ]}
        />
      </div>
      {drawing ? (
        <div role="status" className={styles.strip}>
          <Text variant="small" tone="secondary" className={styles.hint}>
            Drag on the image to select a region. Two fingers pan and zoom.
          </Text>
          <Button size="sm" onClick={() => onDrawing(false)}>
            Done
          </Button>
        </div>
      ) : null}
      {showIgnore && ignoreCount > 0 ? (
        <Text variant="small" tone="secondary" className={styles.note}>
          Ignore regions show here but are edited on a larger screen.
        </Text>
      ) : null}
    </div>
  )
}

export namespace PhoneControls {
  export interface Props {
    /** Which of the four views is on; null for Overlay or Side by side (from the menu). */
    view: PhoneView | null
    hasBase: boolean
    hasHead: boolean
    comparable: boolean
    /** A view of the four, or `side` / `overlay` from the menu. */
    onView: (view: PhoneView | Extract<ViewMode, 'side' | 'overlay'>) => void
    onPrevious: (() => void) | undefined
    onNext: (() => void) | undefined
    /** Comment regions can be drawn on this screenshot. */
    canDraw: boolean
    drawing: boolean
    onDrawing: (on: boolean) => void
    checkerboard: boolean
    onCheckerboard: (on: boolean) => void
    zoom: Zoom
    onZoom: (zoom: Zoom) => void
    /** How many ignore regions the screenshot has (0: no menu item). */
    ignoreCount: number
    showIgnore: boolean
    onShowIgnore: (show: boolean) => void
  }
}
