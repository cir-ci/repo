import type { Build, Comment, Figma, IgnoreRegion, ReviewStatus } from '@circi/api'
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
  FrameIcon,
  ScrollArea,
  SegmentedControl,
  Slider,
  StatusIcon,
  Text,
  Tooltip,
} from '@circi/ui'
import { type CSSProperties, type ReactNode, useState } from 'react'

import { fileUrl } from '#features/builds/api/index.ts'
import type { Size } from '#features/regions/ignore-regions.ts'
import {
  type Annotations,
  RegionLayer,
  RegionOverlay,
  type RegionComposer,
  useRegionGesture,
} from '#features/regions/RegionLayer.tsx'
import { MODE_OPTIONS } from '#lib/shortcuts.ts'
import { usePhone } from '#lib/use-phone.ts'

import { screenshotLabel, screenshotStatus, type ShotKind } from './diff-status.ts'
import { apiSide, draftRegion, type RegionDraft, type RegionSide } from './region-draft.ts'
import { changeSummary } from './review-model.ts'
import { DESIGN_MODE, type ViewMode, VIEW_MODES } from './search.ts'
import { PhoneControls } from './ViewerPhone.tsx'
import { ViewOptionsMenu } from './ViewOptionsMenu.tsx'
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
  designEnabled = false,
  regions,
  ignore,
  issues,
  ...props
}: Viewer.Props) {
  const [opacity, setOpacity] = useState(70)
  const [at, setAt] = useState(50)
  const [zoom, setZoom] = useState<Zoom>('fit')
  // The keyboard way to place a region on this build's image; dragging needs no switch.
  const [keyboardTool, setKeyboardTool] = useState(false)
  const [enlarged, setEnlarged] = useState<string | null>(null)
  const [checkerboard, setCheckerboard] = useState(false)
  // A phone (canvas: Phone, the build page): New and Baseline show one image, Diff and Slider as
  // everywhere, Overlay and Side by side come from the options menu. One finger draws a comment
  // region only in draw mode; ignore regions are shown, never edited.
  const phone = usePhone()
  const [single, setSingle] = useState<'new' | 'baseline' | null>('new')
  const [drawMode, setDrawMode] = useState(false)
  const [showIgnore, setShowIgnore] = useState(false)
  const comparable =
    diff.status === 'changed' && diff.head !== null && diff.base !== null && diff.diff !== null
  const phoneSingle = phone ? single : null
  const mode: ViewMode = phoneSingle
    ? 'side'
    : comparable && (props.mode !== DESIGN_MODE || designEnabled)
      ? props.mode
      : 'side'
  const modeOptions = designEnabled
    ? [...MODE_OPTIONS, { value: DESIGN_MODE, label: 'Design' }]
    : MODE_OPTIONS
  // Regions are drawn on this build's image, so they need one.
  const annotatable =
    (regions !== undefined || ignore !== undefined) && diff.head !== null && mode !== 'design'
  const ignoring = !phone && ignore?.mode === 'ignore'
  // Only one comment box at a time: while the enlarged view is open it owns the selection.
  const annotationsFor = (side: RegionSide, inDialog = false): Annotations | undefined => {
    if (!annotatable) return undefined
    if (ignore && ignoring) return ignoreAnnotations(ignore, side, inDialog)
    if (!regions) return undefined
    const draft = draftRegion(regions.draft, diff.id, side)
    const base = diff.base
    const head = diff.head
    const imageSize = side === 'baseline' ? base : head
    return {
      // A sent comment shows only on the image it was drawn on.
      threads: regions.threads.filter((t) => apiSide(side) === t.side),
      pending: draft,
      pendingKey: regions.draftKey,
      onAdjustPending: regions.onAdjustDraft,
      onAdjust: regions.onAdjust,
      focusedId: regions.focusedId,
      drawing: !inDialog && side === 'build' && keyboardTool,
      onDrawingChange: setKeyboardTool,
      onDraw: (region) => {
        setKeyboardTool(false)
        setDrawMode(false)
        regions.onDraw(side, region)
      },
      onMarker: regions.onMarker,
      // On a phone a finger scrolls the page: it draws only in draw mode.
      alwaysDraw: !phone || drawMode,
      composer: draft && inDialog === (enlarged !== null) ? regions.composer : undefined,
      // View only: the ignore regions the project set, over the screenshot.
      ...(phone && showIgnore && ignore && imageSize?.width && imageSize.height
        ? {
            ignoreRegions: {
              regions: ignore.regions,
              size: { width: imageSize.width, height: imageSize.height },
            },
          }
        : {}),
    }
  }
  // Dragging draws an ignore region: its boxes show on the picture and the comments step aside.
  const ignoreAnnotations = (
    state: IgnoreMode,
    side: RegionSide,
    inDialog: boolean,
  ): Annotations | undefined => {
    const image = side === 'baseline' ? diff.base : diff.head
    const size: Size | null =
      image?.width && image.height ? { width: image.width, height: image.height } : null
    // Regions are fractions of the image: without its size there is nothing to draw or show.
    if (!size) return undefined
    return {
      threads: [],
      pending: state.pending?.side === side ? state.pending.region : null,
      focusedId: null,
      drawing: !inDialog && side === 'build' && keyboardTool,
      onDrawingChange: setKeyboardTool,
      onDraw: (region) => {
        setKeyboardTool(false)
        state.onDraw(side, region, size)
      },
      onMarker: () => {},
      alwaysDraw: true,
      ignoreRegions: {
        regions: state.regions,
        size,
        onAdjust: (item, region) => state.onAdjust(item, region, size),
      },
    }
  }
  const summary = changeSummary(diff)
  // Where the baseline comes from and the commit are in the Details tab; the size is said only
  // when the two differ (the "Size changed" banner says it too).
  const baselineLabel = 'Baseline'
  const baselineCaption = baselineLabel
  const buildCaption = 'This build'
  const differentSizes =
    diff.base !== null &&
    diff.head !== null &&
    (diff.base.width !== diff.head.width || diff.base.height !== diff.head.height)
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
  const overlayAnnotations = annotationsFor(enlarged === 'baseline' ? 'baseline' : 'build', true)
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
        {phone ? (
          <PhoneControls
            view={phoneSingle ?? (mode === 'diff' || mode === 'slider' ? mode : null)}
            hasBase={diff.base !== null}
            hasHead={diff.head !== null}
            comparable={comparable}
            onView={(v) => {
              if (v === 'new' || v === 'baseline') {
                setSingle(v)
              } else {
                setSingle(null)
                props.onMode(v)
              }
            }}
            onPrevious={props.onPrevious}
            onNext={props.onNext}
            canDraw={regions !== undefined && diff.head !== null && mode !== 'design'}
            drawing={drawMode}
            onDrawing={setDrawMode}
            checkerboard={checkerboard}
            onCheckerboard={setCheckerboard}
            zoom={zoom}
            onZoom={setZoom}
            ignoreCount={ignore?.regions.length ?? 0}
            showIgnore={showIgnore}
            onShowIgnore={setShowIgnore}
          />
        ) : (
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
            <ViewOptionsMenu
              checkerboard={checkerboard}
              onCheckerboard={setCheckerboard}
              {...(ignore && annotatable
                ? { drawing: { mode: ignore.mode, onMode: ignore.onMode } }
                : {})}
            />
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
        )}
      </div>
      {issues}

      <ScrollArea
        rootClassName={styles.area}
        className={styles.ground}
        data-checkerboard={checkerboard ? '' : undefined}
      >
        {diff.status === 'failed' ? (
          <Banner tone="danger">
            {diff.errorMessage ?? "This screenshot couldn't be processed."}
          </Banner>
        ) : null}
        {regions?.error && !ignoring ? <Banner tone="danger">{regions.error}</Banner> : null}
        {diff.sizeChanged && diff.base && diff.head ? (
          <Banner tone="warning">
            Size changed from {diff.base.width}×{diff.base.height} to {diff.head.width}×
            {diff.head.height}
          </Banner>
        ) : null}

        {mode === 'side' ? (
          <div
            className={styles.side}
            data-zoomed={zoomed ? '' : undefined}
            data-single={phoneSingle ? '' : undefined}
          >
            {diff.base && phoneSingle !== 'new' ? (
              <Figure
                label={baselineLabel}
                image={diff.base}
                size={differentSizes ? sizeLabel(diff.base) : undefined}
                zoom={zoom}
                annotations={withClick(annotationsFor('baseline'), () => setEnlarged('baseline'))}
                onEnlarge={() => setEnlarged('baseline')}
              />
            ) : null}
            {diff.head && phoneSingle !== 'baseline' ? (
              <Figure
                label={diff.status === 'added' ? 'New in this build' : buildCaption}
                image={diff.head}
                size={differentSizes ? sizeLabel(diff.head) : undefined}
                zoom={zoom}
                annotations={withClick(annotationsFor('build'), () => setEnlarged('build'))}
                onEnlarge={() => setEnlarged('build')}
              />
            ) : null}
            {phoneSingle === 'baseline' && !diff.base ? (
              <Text tone="secondary" as="p" className={styles.note}>
                This screenshot is new, so there is no baseline.
              </Text>
            ) : null}
            {!diff.head && diff.base ? (
              <Text tone="secondary" as="p" className={styles.note}>
                This screenshot isn't in this build any more.
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
            size={differentSizes ? sizeLabel(diff.diff) : undefined}
            zoom={zoom}
            annotations={withClick(annotationsFor('build'), () => setEnlarged('diff'))}
            onEnlarge={() => setEnlarged('diff')}
          />
        ) : null}

        {ignoring && ignore ? ignore.panel : null}

        {mode === 'design' ? (
          <EmptyState icon={<FrameIcon />} size="section" title="No design linked">
            The frame this screenshot is built from will show here.
          </EmptyState>
        ) : null}
      </ScrollArea>
      <ImageDialog
        images={enlargeable.map((e) => ({
          src: fileUrl(e.image.sha256),
          caption: e.caption,
          label: e.label,
          ...(e.image.width ? { width: e.image.width } : {}),
          ...(e.image.height ? { height: e.image.height } : {}),
          ...(annotatable && enlarged === e.key && overlayAnnotations
            ? { overlay: <RegionOverlay annotations={overlayAnnotations} /> }
            : {}),
        }))}
        hint={
          annotatable && overlayAnnotations
            ? ignoring
              ? 'drag to add an ignore region'
              : 'drag to comment on a region'
            : undefined
        }
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
    onMode: (m: ViewMode) => void
    /** Absent at the first / last screenshot. */
    onPrevious: (() => void) | undefined
    onNext: (() => void) | undefined
    onHelp: () => void
    /** Offers the Design mode (key 5); false until the Figma integration exists. */
    designEnabled?: boolean
    /** Comment regions on this snapshot; absent where nobody can comment. */
    regions?: Regions
    /** Dragging can draw ignore regions instead of comments; absent unless you can manage them. */
    ignore?: IgnoreMode
    /** The link row for issues filed about this snapshot, right under the toolbar. */
    issues?: ReactNode
  }
}

/** What a drag on the picture draws, and the ignore regions of the screenshot while it draws them. */
export interface IgnoreMode {
  mode: 'comments' | 'ignore'
  onMode: (mode: 'comments' | 'ignore') => void
  regions: readonly IgnoreRegion.Item[]
  /** The region just drawn, while it is being saved. */
  pending: { side: RegionSide; region: Comment.Region } | null
  /** `size` is the pixel size of the image it was drawn on. */
  onDraw: (side: RegionSide, region: Comment.Region, size: Size) => void
  /** An ignore region was moved or resized by dragging it; `size` is the pixel size of its image. */
  onAdjust: (item: IgnoreRegion.Item, region: Comment.Region, size: Size) => void | Promise<unknown>
  /** The list of the regions, with Add, Edit and Remove. */
  panel: ReactNode
}

/** The regions of the snapshot on screen: sent threads, and the one selected region with its draft. */
export interface Regions {
  threads: (Annotations['threads'][number] & { side: Comment.RegionSide })[]
  focusedId: string | null
  /** The selected region and the snapshot and side it was drawn on. */
  draft: RegionDraft | null
  /** A new number for each region drawn: moving the draft keeps the text typed so far. */
  draftKey: number
  /** The draft was moved or resized by dragging it. */
  onAdjustDraft: (region: Comment.Region) => void
  /** A sent comment's region was moved or resized by its author. */
  onAdjust: (id: string, region: Comment.Region) => void | Promise<unknown>
  /** Why the last region save failed, until the next one. */
  error?: string | undefined
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

/** "1280 × 960", or nothing when the image's size isn't known. */
const sizeLabel = (image: Build.ImageRef): string | undefined =>
  image.width && image.height ? `${image.width} × ${image.height}` : undefined

function Figure({ label, size, image, zoom, annotations, onEnlarge }: Figure.Props) {
  const gesture = useRegionGesture(annotations)
  const drawsOnPointer = annotations?.alwaysDraw === true
  return (
    <figure className={styles.figure}>
      <div className={styles.captionRow}>
        <Text as="small" variant="small" tone="secondary" className={styles.caption}>
          {label}
        </Text>
        {size ? (
          <Text as="small" variant="small" tone="tertiary">
            {size}
          </Text>
        ) : null}
      </div>
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
    /** The image's size, "1280 × 960", shown on the right of the label. */
    size?: string | undefined
    image: Build.ImageRef
    zoom: Zoom
    annotations?: Annotations | undefined
    onEnlarge: () => void
  }
}
