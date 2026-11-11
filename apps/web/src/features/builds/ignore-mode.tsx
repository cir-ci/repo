import type { Build } from '@circi/api'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import {
  ignoreRegionsQuery,
  settingsQuery,
  useAddIgnoreRegion,
  useAdjustIgnoreRegion,
} from '#features/projects/api/index.ts'
import { regionsOf, toPixels } from '#features/regions/ignore-regions.ts'
import { IgnoreRegionsPanel } from '#features/regions/IgnoreRegionsPanel.tsx'
import { toast } from '#lib/toast.ts'

import type { IgnoreMode } from './DiffViewer.tsx'
import type { RegionSide } from './region-draft.ts'

/**
 * What the viewer needs to let owners and admins (`canManage`, as on the baseline page) draw
 * ignore regions on the screenshot on show; undefined for everyone else and while that isn't known.
 * A region drawn is saved at once, through the same calls the baseline page uses.
 */
export function useIgnoreMode(
  workspace: string,
  project: string,
  shot: Build.DiffItem | undefined,
): IgnoreMode | undefined {
  const settings = useQuery(settingsQuery(workspace, project))
  const canManage = settings.data?.canManage === true
  const name = shot?.name
  const list = useQuery({
    ...ignoreRegionsQuery(workspace, project, name),
    enabled: canManage && name !== undefined,
  })
  const add = useAddIgnoreRegion(workspace, project)
  const adjust = useAdjustIgnoreRegion(workspace, project)
  const [mode, setMode] = useState<IgnoreMode['mode']>('comments')
  const [pending, setPending] = useState<IgnoreMode['pending']>(null)
  if (!canManage || !shot) return undefined

  const regions = regionsOf(list.data?.regions ?? [], shot.name)
  const image = shot.head ?? shot.base
  return {
    mode,
    onMode: setMode,
    regions,
    pending,
    onDraw: (side: RegionSide, region, size) => {
      setPending({ side, region })
      add.mutate(
        { name: shot.name, ...toPixels(region, size) },
        {
          onSuccess: () => toast('Ignore region added'),
          onSettled: () => setPending(null),
        },
      )
    },
    onAdjust: (item, region, size) =>
      adjust
        .mutateAsync({ id: item.id, rect: toPixels(region, size) })
        .then(() => toast('Ignore region saved'))
        .catch(() => undefined),
    panel: (
      <IgnoreRegionsPanel
        workspace={workspace}
        project={project}
        name={shot.name}
        size={image?.width && image.height ? { width: image.width, height: image.height } : null}
        regions={regions}
        canManage
        error={add.error?.message ?? adjust.error?.message}
        footer={false}
      />
    ),
  }
}
