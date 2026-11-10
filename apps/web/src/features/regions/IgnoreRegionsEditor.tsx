import type { Comment, IgnoreRegion } from '@circi/api'
import { Heading, IconButton, ImageDialog, Text, Tooltip, useAnnounce } from '@circi/ui'
import { useQuery } from '@tanstack/react-query'
import { useId, useState } from 'react'

import { fileUrl } from '#features/builds/api/index.ts'
import { ignoreRegionsQuery, useAddIgnoreRegion } from '#features/teams/api/index.ts'
import { ErrorState } from '#lib/ErrorState.tsx'

import { regionsOf, sizeOf, toPixels } from './ignore-regions.ts'
import { IgnoreRegionsPanel } from './IgnoreRegionsPanel.tsx'
import { type Annotations, RegionOverlay } from './RegionLayer.tsx'
import { RegionBoxes, RegionStage } from './RegionStage.tsx'

import styles from './IgnoreRegionsEditor.module.css'

/**
 * One screenshot's baseline image with its ignore regions drawn over it (click to enlarge), and
 * the regions as a list: add one from numbers or by dragging over the image (or with the keyboard
 * tool), edit or remove one. Owners and admins (`canManage`) get the controls; members see the regions. Each
 * confirmed action applies when it is confirmed. The baseline page puts this under its header.
 */
export function IgnoreRegionsEditor({
  workspace,
  team,
  name,
  latest,
  defaultBranch,
  canManage,
}: IgnoreRegionsEditor.Props) {
  const { data, error, refetch } = useQuery(ignoreRegionsQuery(workspace, team, name))
  const announce = useAnnounce()
  const add = useAddIgnoreRegion(workspace, team)
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
                onSuccess: () => announce('Ignore region added'),
                onSettled: () => setPending(null),
              },
            )
          },
          onMarker: () => {},
          alwaysDraw: true,
          onClick: () => setEnlarged(true),
        }
      : undefined

  return (
    <>
      <section className={styles.panel} aria-labelledby={imageHeading}>
        <div className={styles.bar}>
          <Heading as="h2" id={imageHeading} className={styles.barTitle}>
            Baseline image
          </Heading>
          {latest ? (
            <Text variant="small" tone="tertiary">
              {regions.length} ignore {regions.length === 1 ? 'region' : 'regions'} drawn over it.
              {annotations ? ' Drag to add one, click to enlarge.' : ' Click to enlarge.'}
            </Text>
          ) : null}
          {annotations ? (
            // Dragging needs no button: the keyboard path stays, shown only while it has focus.
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
        </div>
        {latest ? (
          <RegionStage
            name={name}
            latest={latest}
            size={size}
            regions={regions}
            annotations={annotations}
            onEnlarge={() => setEnlarged(true)}
          />
        ) : (
          <Text as="p" tone="secondary" className={styles.note}>
            There is no baseline named {name} on {defaultBranch} yet, so there is nothing to draw
            on.
          </Text>
        )}
      </section>

      <IgnoreRegionsPanel
        workspace={workspace}
        team={team}
        name={name}
        size={size}
        regions={regions}
        canManage={canManage}
        error={add.error?.message}
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
                    overlay: (
                      <>
                        <RegionBoxes regions={regions} size={size} />
                        {annotations ? (
                          // The keyboard tool belongs to the inline image.
                          <RegionOverlay annotations={{ ...annotations, drawing: false }} />
                        ) : null}
                      </>
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
    team: string
    /** The screenshot's name: the regions of this name are listed. */
    name: string
    /** The baseline image to draw on; null when the screenshot has none (nothing can be drawn). */
    latest: IgnoreRegion.Snapshot['latest']
    defaultBranch: string
    /** Owners and admins: the others see the regions and nothing to change them with. */
    canManage: boolean
  }
}
