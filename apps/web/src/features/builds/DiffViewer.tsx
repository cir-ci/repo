import type { Build, Comment, Figma, ReviewStatus } from '@circi/api'
import {
  Banner,
  Button,
  EmptyState,
  EnlargeTrigger,
  ExpandLessIcon,
  ExpandMoreIcon,
  Heading,
  IconButton,
  ImageDialog,
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

import { fileUrl } from '#features/builds/api/index.ts'
import {
  type Annotations,
  RegionLayer,
  RegionOverlay,
  type RegionComposer,
  useRegionGesture,
} from '#features/regions/RegionLayer.tsx'
import { MODE_OPTIONS } from '#lib/shortcuts.ts'

import { screenshotLabel, screenshotStatus, type ShotKind } from './diff-status.ts'
import { apiSide, draftRegion, type RegionDraft, type RegionSide } from './region-draft.ts'
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
  baselineBranch,
  commitSha,
  designEnabled = false,
  regions,
  issues,
  ...props
}: Viewer.Props) {
  const [opacity, setOpacity] = useState(70)
  const [at, setAt] = useState(50)
  const [zoom, setZoom] = useState<Zoom>('fit')
  // The keyboard way to place a region on this build's image; dragging needs no switch.
  const [keyboardTool, setKeyboardTool] = useState(false)
  const [enlarged, setEnlarged] = useState<string | null>(null)
  const comparable =
    diff.status === 'changed' && diff.head !== null && diff.base !== null && diff.diff !== null
  const mode: ViewMode =
    comparable && (props.mode !== DESIGN_MODE || designEnabled) ? props.mode : 'side'
  const modeOptions = designEnabled
    ? [...MODE_OPTIONS, { value: DESIGN_MODE, label: 'Design' }]
    : MODE_OPTIONS
  // Regions are drawn on this build's image, so they need one.
  const annotatable = regions !== undefined && diff.head !== null && mode !== 'design'
  // Only one comment box at a time: while the enlarged view is open it owns the selection.
  const annotationsFor = (side: RegionSide, inDialog = false): Annotations | undefined => {
    if (!regions || !annotatable) return undefined
    const draft = draftRegion(regions.draft, diff.id, side)
    return {
      // A sent comment shows only on the image it was drawn on.
      threads: regions.threads.filter((t) => apiSide(side) === t.side),
      pending: draft,
      focusedId: regions.focusedId,
      drawing: !inDialog && side === 'build' && keyboardTool,
      onDrawingChange: setKeyboardTool,
      onDraw: (region) => {
        setKeyboardTool(false)
        regions.onDraw(side, region)
      },
      onMarker: regions.onMarker,
      alwaysDraw: true,
      composer: draft && inDialog === (enlarged !== null) ? regions.composer : undefined,
    }
  }
  const summary = changeSummary(diff)
  const baselineLabel = baselineNumber ? `Baseline · build #${baselineNumber}` : 'Baseline'
  const baselineCaption = baselineNumber
    ? `Baseline · build #${baselineNumber} on ${baselineBranch ?? 'an unknown branch'}`
    : 'Baseline'
  const buildCaption = commitSha ? `This build · ${commitSha.slice(0, 7)}` : 'This build'
  // What the enlarged view can show: the baseline, this build and, in Diff mode, the changed pixels.
  const enlargeable: { key: string; image: Build.ImageRef; caption: string; label: string }[] = [
    ...(diff.base
      ? [{ key: 'baseline', image: diff.base, caption: baselineCaption, label: 'Baseline' }]
      : []),
    ...(diff.head
      ? [{ key: 'build', image: diff.head, caption: buildCaption, label: 'This build' }]
      : []),
    ...(mode === 'diff' && diff.diff
      ? [
          {
            key: 'diff',
            image: diff.diff,
            caption: 'Changed pixels in red',
            label: 'Changed pixels',
          },
        ]
      : []),
  ]
  const enlargedAt = enlargeable.findIndex((e) => e.key === enlarged)
  const layer = annotationsFor('build')
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
          {comparable && mode === 'slider' ? (
            <span className={styles.slider}>
              <Text variant="small" tone="secondary">
                Slider
              </Text>
              <Slider
                label="Slider position"
                min={0}
                max={100}
                step={1}
                value={at}
                onValueChange={setAt}
              />
            </span>
          ) : null}
          {annotatable ? (
            <Text variant="small" tone="secondary" className={styles.hint}>
              Drag on an image to comment on a region
            </Text>
          ) : null}
          {annotatable ? (
            // The board's toolbar has no button for it: the keyboard path stays, shown only while it has focus.
            <span className={styles.keyTool} data-on={keyboardTool ? '' : undefined}>
              <Tooltip content="Mark a region with the keyboard: arrow keys move it, Shift and arrow keys resize it, Enter confirms">
                <IconButton
                  label="Mark a region with the keyboard"
                  aria-pressed={keyboardTool}
                  onClick={() => setKeyboardTool(!keyboardTool)}
                >
                  <span aria-hidden="true">⌖</span>
                </IconButton>
              </Tooltip>
            </span>
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
            {diff.base ? (
              <Figure
                label={baselineLabel}
                image={diff.base}
                zoom={zoom}
                annotations={withClick(annotationsFor('baseline'), () => setEnlarged('baseline'))}
                onEnlarge={() => setEnlarged('baseline')}
              />
            ) : null}
            {diff.head ? (
              <Figure
                label={diff.status === 'added' ? 'New in this build' : 'This build'}
                image={diff.head}
                zoom={zoom}
                annotations={withClick(annotationsFor('build'), () => setEnlarged('build'))}
                onEnlarge={() => setEnlarged('build')}
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
              {layer ? <RegionLayer annotations={layer} /> : null}
            </div>
          </figure>
        ) : null}

        {mode === 'slider' && diff.base && diff.head ? (
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
              {layer ? <RegionLayer annotations={layer} /> : null}
            </div>
          </figure>
        ) : null}

        {mode === 'diff' && diff.diff ? (
          <Figure
            label="Changed pixels in red"
            image={diff.diff}
            zoom={zoom}
            annotations={withClick(annotationsFor('build'), () => setEnlarged('diff'))}
            onEnlarge={() => setEnlarged('diff')}
          />
        ) : null}

        {mode === 'design' ? (
          <EmptyState icon={<ReviewIcon size={32} />} title="Design compare">
            The frame this screenshot is built from will show here.
          </EmptyState>
        ) : null}
      </div>
      <ImageDialog
        images={enlargeable.map((e) => ({
          src: fileUrl(e.image.sha256),
          caption: e.caption,
          label: e.label,
          ...(e.image.width ? { width: e.image.width } : {}),
          ...(e.image.height ? { height: e.image.height } : {}),
          ...(annotatable && enlarged === e.key
            ? {
                overlay: (
                  <RegionOverlay
                    annotations={annotationsFor(e.key === 'baseline' ? 'baseline' : 'build', true)!}
                  />
                ),
              }
            : {}),
        }))}
        open={enlarged !== null && enlargedAt >= 0}
        index={Math.max(enlargedAt, 0)}
        onIndexChange={(i) => setEnlarged(enlargeable[i]?.key ?? null)}
        onOpenChange={(open) => {
          if (!open) setEnlarged(null)
        }}
      />
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
    /** The baseline's branch, for the enlarged view's caption. */
    baselineBranch?: string | null | undefined
    /** This build's commit, for the enlarged view's caption. */
    commitSha?: string | undefined
    onMode: (m: ViewMode) => void
    /** Absent at the first / last screenshot. */
    onPrevious: (() => void) | undefined
    onNext: (() => void) | undefined
    onHelp: () => void
    /** Offers the Design mode (key 5); false until the Figma integration exists. */
    designEnabled?: boolean
    /** Comment regions on this snapshot; absent where nobody can comment. */
    regions?: Regions
    /** The link row for issues filed about this snapshot, right under the toolbar. */
    issues?: ReactNode
  }
}

/** The regions of the snapshot on screen: sent threads, and the one selected region with its draft. */
export interface Regions {
  threads: (Annotations['threads'][number] & { side: Comment.RegionSide })[]
  focusedId: string | null
  /** The selected region and the snapshot and side it was drawn on. */
  draft: RegionDraft | null
  onDraw: (side: RegionSide, region: Comment.Region) => void
  onMarker: (id: string) => void
  composer: RegionComposer.Callbacks
}

/** A click on an image (a press that does not draw) enlarges it. */
const withClick = (a: Annotations | undefined, onClick: () => void): Annotations | undefined =>
  a && { ...a, onClick }

const imageStyle = (zoom: Zoom, naturalWidth: number | null): CSSProperties | undefined => {
  const width = zoomedWidth(zoom, naturalWidth)
  return width === undefined ? undefined : { width, maxWidth: 'none' }
}

function Figure({ label, image, zoom, annotations, onEnlarge }: Figure.Props) {
  const gesture = useRegionGesture(annotations)
  const drawsOnPointer = annotations?.alwaysDraw === true
  return (
    <figure className={styles.figure}>
      <Text as="small" variant="small" tone="secondary" className={styles.caption}>
        {label}
      </Text>
      {/* A press on the image either drags a region or, without moving, enlarges it. The layer is
          a sibling of the trigger, never inside it: markers are buttons. */}
      <div
        className={styles.stage}
        data-annotatable={drawsOnPointer ? '' : undefined}
        {...gesture.bind}
      >
        <div className={styles.frame}>
          <EnlargeTrigger
            label={`Enlarge ${label}`}
            onClick={(e) => {
              // A mouse press was already told apart from a drag when it ended; a key press was not.
              if (drawsOnPointer && e.detail !== 0) return
              onEnlarge()
            }}
          >
            <img
              src={fileUrl(image.sha256)}
              alt={label}
              draggable={false}
              className={styles.image}
              style={imageStyle(zoom, image.width)}
            />
          </EnlargeTrigger>
        </div>
        {annotations ? (
          <div className={styles.inset}>
            <RegionLayer annotations={annotations} gesture={gesture} />
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
    onEnlarge: () => void
  }
}
