import type { Comment, IgnoreRegion } from '@circi/api'
import { Heading, ImageDialog, Text } from '@circi/ui'
import { useQuery } from '@tanstack/react-query'
import { useId, useState } from 'react'

import { fileUrl } from '#features/builds/api/index.ts'
import {
  ignoreRegionsQuery,
  useAddIgnoreRegion,
  useAdjustIgnoreRegion,
} from '#features/projects/api/index.ts'
import { ErrorState } from '#lib/ErrorState.tsx'
import { toast } from '#lib/toast.ts'
import { usePhone } from '#lib/use-phone.ts'

import { regionsOf, sizeOf, toPixels } from './ignore-regions.ts'
import { IgnoreRegionsPanel } from './IgnoreRegionsPanel.tsx'
import { KeyboardRegionToggle } from './KeyboardRegionToggle.tsx'
import { RegionBoxes } from './RegionBoxes.tsx'
import { type Annotations, RegionOverlay } from './RegionLayer.tsx'
import { RegionStage } from './RegionStage.tsx'

import styles from './IgnoreRegionsEditor.module.css'

/**
 * One screenshot's baseline image with its ignore regions drawn over it, and
 * the regions as a list: add one from numbers or by dragging over the image (or with the keyboard
 * tool), edit or remove one. Owners and admins (`canManage`) get the controls; members see the regions. Each
 * confirmed action applies when it is confirmed. The baseline page puts this under its header.
 */
export function IgnoreRegionsEditor({
  workspace,
  project,
  name,
  latest,
  defaultBranch,
  canManage: allowed,
}: IgnoreRegionsEditor.Props) {
  // Drawing or moving a region needs pixel-level handles: on a phone the regions are shown, not edited.
  const phone = usePhone()
  const canManage = allowed && !phone
  const { data, error, refetch } = useQuery(ignoreRegionsQuery(workspace, project, name))
  const add = useAddIgnoreRegion(workspace, project)
  const adjust = useAdjustIgnoreRegion(workspace, project)
  // The keyboard way to place a region; dragging needs no switch.
  const [keyboardTool, setKeyboardTool] = useState(false)
  const [pending, setPending] = useState<Comment.Region | null>(null)
  const [enlarged, setEnlarged] = useState(false)
  const imageHeading = useId()

  if (error) return <ErrorState error={error} onRetry={() => void refetch()} />
  if (!data) return null

  const regions = regionsOf(data.regions, name)
  const size = sizeOf(latest)
  // Owners and admins draw by dragging: a drag adds the region at once, a press that does not draw enlarges.
  const annotations: Annotations | undefined =
    canManage && size
      ? {
          threads: [],
          pending,
          focusedId: null,
          drawing: keyboardTool,
          onDrawingChange: setKeyboardTool,
          onDraw: (region) => {
            setKeyboardTool(false)
            setPending(region)
            add.mutate(
              { name, ...toPixels(region, size) },
              {
                onSuccess: () => toast('Ignore region added'),
                onSettled: () => setPending(null),
              },
            )
          },
          onMarker: () => {},
          alwaysDraw: true,
          onClick: () => setEnlarged(true),
          // Owners and admins also move and resize the regions by dragging them.
          ignoreRegions: {
            regions,
            size,
            // The promise keeps the box where it was dropped until the save has settled.
            onAdjust: (item, region) =>
              adjust
                .mutateAsync({ id: item.id, rect: toPixels(region, size) })
                .then(() => toast('Ignore region saved'))
                .catch(() => undefined),
          },
        }
      : undefined

  return (
    <>
      {latest ? (
        <section className={styles.panel} aria-labelledby={imageHeading}>
          <div className={styles.bar}>
            <Heading as="h2" id={imageHeading} className={styles.barTitle}>
              Baseline image
            </Heading>
            {annotations ? (
              <Text variant="small" tone="tertiary">
                Drag on the image to draw an ignore region.
              </Text>
            ) : null}
            {annotations ? (
              <KeyboardRegionToggle on={keyboardTool} onChange={setKeyboardTool} />
            ) : null}
          </div>
          <RegionStage
            name={name}
            latest={latest}
            size={size}
            regions={regions}
            annotations={annotations}
            onEnlarge={() => setEnlarged(true)}
          />
        </section>
      ) : null}

      {allowed && phone ? (
        <Text variant="small" tone="secondary">
          Ignore regions are edited on a larger screen. They apply here as usual.
        </Text>
      ) : null}
      <IgnoreRegionsPanel
        workspace={workspace}
        project={project}
        name={name}
        size={size}
        regions={regions}
        canManage={canManage}
        error={add.error?.message ?? adjust.error?.message}
      />

      {latest ? (
        <ImageDialog
          images={[
            {
              src: fileUrl(latest.sha256),
              caption: `${name} · build #${latest.buildNumber} on ${defaultBranch}`,
              alt: `${name} in build #${latest.buildNumber}, enlarged`,
              ...(size ? size : {}),
              ...(size
                ? {
                    overlay: annotations ? (
                      // The keyboard tool belongs to the inline image.
                      <RegionOverlay annotations={{ ...annotations, drawing: false }} />
                    ) : (
                      <RegionBoxes regions={regions} size={size} />
                    ),
                  }
                : {}),
            },
          ]}
          open={enlarged}
          index={0}
          onIndexChange={() => {}}
          onOpenChange={setEnlarged}
        />
      ) : null}
    </>
  )
}

export namespace IgnoreRegionsEditor {
  export interface Props {
    workspace: string
    project: string
    /** The screenshot's name: the regions of this name are listed. */
    name: string
    /** The baseline image to draw on; null when the screenshot has none (nothing can be drawn). */
    latest: IgnoreRegion.Snapshot['latest']
    defaultBranch: string
    /** Owners and admins: the others see the regions and nothing to change them with. */
    canManage: boolean
  }
}
