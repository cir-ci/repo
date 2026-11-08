import type { Build, Figma, ReviewStatus } from '@circi/api'
import {
  Banner,
  Button,
  EmptyState,
  ExpandLessIcon,
  ExpandMoreIcon,
  Heading,
  IconButton,
  Kbd,
  Link,
  ReviewIcon,
  SegmentedControl,
  Slider,
  StatusIcon,
  Text,
  Tooltip,
} from '@circi/ui'
import { type CSSProperties, type ReactNode, useState } from 'react'

import { MODE_OPTIONS } from '#lib/shortcuts.ts'

import { fileUrl } from './api.ts'
import { screenshotLabel, screenshotStatus, type ShotKind } from './diff-status.ts'
import { type Annotations, RegionLayer } from './RegionLayer.tsx'
import { changeSummary } from './review-model.ts'
import { DESIGN_MODE, type ViewMode, VIEW_MODES } from './search.ts'
import { type Zoom, stepZoom, zoomedWidth, zoomLabel } from './zoom.ts'

import styles from './DiffViewer.module.css'

/** A small link to the Figma frame this snapshot is linked to, opening it in Figma. */
export function FigmaFrameChip({ frame }: { frame: Figma.Frame }) {
  return (
    <Link
      className={styles.figmaChip}
      href={frame.url}
      target="_blank"
      rel="noopener noreferrer"
      title={frame.frameName ?? 'Open the linked frame in Figma'}
    >
      Figma frame{frame.frameName ? `: ${frame.frameName}` : ''}
    </Link>
  )
}

const isViewMode = (value: string): value is ViewMode =>
  value === DESIGN_MODE || VIEW_MODES.some((m) => m === value)

/**
 * The screenshot viewer: a 36px toolbar (name, view modes, zoom, previous and next) over a
 * checkerboard ground that holds the images, so transparent pixels show and nothing else
 * competes with them. At "fit" an image is never scaled up past its real size.
 */
export function Viewer({
  diff,
  kind,
  review,
  baselineNumber,
  designEnabled = false,
  annotations,
  issues,
  ...props
}: Viewer.Props) {
  const [opacity, setOpacity] = useState(70)
  const [at, setAt] = useState(50)
  const [zoom, setZoom] = useState<Zoom>('fit')
  const comparable =
    diff.status === 'changed' && diff.head !== null && diff.base !== null && diff.diff !== null
  const mode: ViewMode =
    comparable && (props.mode !== DESIGN_MODE || designEnabled) ? props.mode : 'side'
  const modeOptions = designEnabled
    ? [...MODE_OPTIONS, { value: DESIGN_MODE, label: 'Design' }]
    : MODE_OPTIONS
  // Regions are drawn on this build's image, so they need one.
  const annotate = diff.head !== null && mode !== 'design' ? annotations : undefined
  const summary = changeSummary(diff)
  const baselineLabel = baselineNumber ? `Baseline · build #${baselineNumber}` : 'Baseline'
  const zoomed = zoom !== 'fit'

  return (
    <section aria-labelledby="viewer-title" className={styles.viewer}>
      <div className={styles.toolbar}>
        <div className={styles.title}>
          <StatusIcon
            status={screenshotStatus(kind, review)}
            size={12}
            label={screenshotLabel(kind, review)}
          />
          <Heading as="h2" id="viewer-title" title={diff.name} className={styles.name}>
            {diff.name}
          </Heading>
          {summary ? (
            <Text variant="mono" tone="secondary" className={styles.summary}>
              {summary}
            </Text>
          ) : null}
          {diff.figma ? <FigmaFrameChip frame={diff.figma} /> : null}
        </div>
        <div className={styles.controls}>
          {comparable ? (
            <SegmentedControl
              label="View"
              options={modeOptions}
              value={mode}
              onChange={(m) => {
                if (isViewMode(m)) props.onMode(m)
              }}
            />
          ) : null}
          {comparable && mode === 'overlay' ? (
            <span className={styles.slider}>
              <Text variant="small" tone="secondary">
                Diff layer
              </Text>
              <Slider
                label="Diff layer"
                min={0}
                max={100}
                step={5}
                value={opacity}
                onValueChange={setOpacity}
              />
            </span>
          ) : null}
          {comparable && mode === 'swipe' ? (
            <span className={styles.slider}>
              <Text variant="small" tone="secondary">
                Swipe
              </Text>
              <Slider
                label="Swipe position"
                min={0}
                max={100}
                step={1}
                value={at}
                onValueChange={setAt}
              />
            </span>
          ) : null}
          {annotate ? (
            <Tooltip content="Drag over the screenshot, or use the arrow keys, to comment on a region">
              <Button
                variant="toggle"
                size="sm"
                aria-pressed={annotate.drawing}
                onClick={() => annotate.onDrawingChange(!annotate.drawing)}
              >
                Comment on a region
              </Button>
            </Tooltip>
          ) : null}
          <div className={styles.group}>
            <SegmentedControl
              label="Zoom"
              options={[
                { value: 'fit', label: 'Fit' },
                { value: '100', label: '100%' },
              ]}
              value={zoom === 'fit' ? 'fit' : zoom === 100 ? '100' : ''}
              onChange={(z) => setZoom(z === 'fit' ? 'fit' : 100)}
            />
            <IconButton label="Zoom out" onClick={() => setZoom(stepZoom(zoom, -1))}>
              <span aria-hidden="true">−</span>
            </IconButton>
            <IconButton label="Zoom in" onClick={() => setZoom(stepZoom(zoom, 1))}>
              <span aria-hidden="true">+</span>
            </IconButton>
            {zoomed && zoom !== 100 ? (
              <Text variant="mono" tone="secondary" aria-live="polite">
                {zoomLabel(zoom)}
              </Text>
            ) : null}
          </div>
          <div className={styles.group}>
            <Tooltip
              content={
                <>
                  Previous screenshot <Kbd>k</Kbd>
                </>
              }
            >
              <IconButton
                label="Previous screenshot"
                disabled={!props.onPrevious}
                onClick={props.onPrevious}
              >
                <ExpandLessIcon />
              </IconButton>
            </Tooltip>
            <Tooltip
              content={
                <>
                  Next screenshot <Kbd>j</Kbd>
                </>
              }
            >
              <IconButton label="Next screenshot" disabled={!props.onNext} onClick={props.onNext}>
                <ExpandMoreIcon />
              </IconButton>
            </Tooltip>
            <Button
              variant="ghost"
              size="sm"
              aria-label="Keyboard shortcuts"
              onClick={props.onHelp}
            >
              <Kbd>?</Kbd>
            </Button>
          </div>
        </div>
      </div>
      {issues}

      <div className={styles.ground}>
        {diff.status === 'failed' ? (
          <Banner tone="danger">
            {diff.errorMessage ?? 'This screenshot couldn’t be processed.'}
          </Banner>
        ) : null}
        {diff.sizeChanged && diff.base && diff.head ? (
          <Banner tone="warning">
            Size changed from {diff.base.width}×{diff.base.height} to {diff.head.width}×
            {diff.head.height}
          </Banner>
        ) : null}

        {mode === 'side' ? (
          <div className={styles.side} data-zoomed={zoomed ? '' : undefined}>
            {diff.base ? <Figure label={baselineLabel} image={diff.base} zoom={zoom} /> : null}
            {diff.head ? (
              <Figure
                label={diff.status === 'added' ? 'New in this build' : 'This build'}
                image={diff.head}
                zoom={zoom}
                annotations={annotate}
              />
            ) : null}
            {!diff.head && diff.base ? (
              <Text tone="secondary" as="p" className={styles.note}>
                This screenshot isn’t in this build any more.
              </Text>
            ) : null}
          </div>
        ) : null}

        {mode === 'overlay' && diff.head && diff.diff ? (
          <figure className={styles.figure}>
            <Text as="small" variant="small" tone="secondary" className={styles.caption}>
              This build, with changed pixels highlighted
            </Text>
            <div className={styles.frame}>
              <img
                src={fileUrl(diff.head.sha256)}
                alt={`${diff.name} in this build`}
                className={styles.image}
                style={imageStyle(zoom, diff.head.width)}
              />
              <img
                src={fileUrl(diff.diff.sha256)}
                alt=""
                className={styles.cover}
                style={{ opacity: opacity / 100 }}
              />
              {annotate ? <RegionLayer annotations={annotate} /> : null}
            </div>
          </figure>
        ) : null}

        {mode === 'swipe' && diff.base && diff.head ? (
          <figure className={styles.figure}>
            <Text as="small" variant="small" tone="secondary" className={styles.caption}>
              {baselineLabel} on the left, this build on the right
            </Text>
            <div className={styles.frame}>
              <img
                src={fileUrl(diff.base.sha256)}
                alt={`${diff.name} in the baseline`}
                className={styles.image}
                style={imageStyle(zoom, diff.base.width)}
              />
              <img
                src={fileUrl(diff.head.sha256)}
                alt={`${diff.name} in this build`}
                className={styles.cover}
                style={{ clipPath: `inset(0 0 0 ${at}%)` }}
              />
              <span aria-hidden="true" className={styles.divider} style={{ left: `${at}%` }} />
              {annotate ? <RegionLayer annotations={annotate} /> : null}
            </div>
          </figure>
        ) : null}

        {mode === 'diff' && diff.diff ? (
          <Figure
            label="Changed pixels in red"
            image={diff.diff}
            zoom={zoom}
            annotations={annotate}
          />
        ) : null}

        {mode === 'design' ? (
          <EmptyState icon={<ReviewIcon size={32} />} title="Design compare">
            The frame this screenshot is built from will show here.
          </EmptyState>
        ) : null}
      </div>
    </section>
  )
}

export namespace Viewer {
  export interface Props {
    diff: Build.DiffItem
    kind: ShotKind
    /** The build's review (`shotReview`): the glyph follows it. */
    review: ReviewStatus
    mode: ViewMode
    baselineNumber: number | undefined
    onMode: (m: ViewMode) => void
    /** Absent at the first / last screenshot. */
    onPrevious: (() => void) | undefined
    onNext: (() => void) | undefined
    onHelp: () => void
    /** Offers the Design mode (key 5); false until the Figma integration exists. */
    designEnabled?: boolean
    /** Comment regions on this snapshot; absent where nobody can comment. */
    annotations?: Annotations
    /** The link row for issues filed about this snapshot, right under the toolbar. */
    issues?: ReactNode
  }
}

const imageStyle = (zoom: Zoom, naturalWidth: number | null): CSSProperties | undefined => {
  const width = zoomedWidth(zoom, naturalWidth)
  return width === undefined ? undefined : { width, maxWidth: 'none' }
}

function Figure({ label, image, zoom, annotations }: Figure.Props) {
  return (
    <figure className={styles.figure}>
      <Text as="small" variant="small" tone="secondary" className={styles.caption}>
        {label}
      </Text>
      {/* The layer is a sibling of the link, never inside it: markers are buttons. */}
      <div className={styles.stage}>
        <a
          href={fileUrl(image.sha256)}
          target="_blank"
          rel="noopener noreferrer"
          title="Open full size"
          className={styles.frame}
        >
          <img
            src={fileUrl(image.sha256)}
            alt={label}
            className={styles.image}
            style={imageStyle(zoom, image.width)}
          />
        </a>
        {annotations ? (
          <div className={styles.inset}>
            <RegionLayer annotations={annotations} />
          </div>
        ) : null}
      </div>
    </figure>
  )
}

export namespace Figure {
  export interface Props {
    label: string
    image: Build.ImageRef
    zoom: Zoom
    annotations?: Annotations | undefined
  }
}
