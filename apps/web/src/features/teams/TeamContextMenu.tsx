import { ContextMenu } from '@circi/ui'
import { useRouter } from '@tanstack/react-router'
import type { ReactNode } from 'react'

import { useSidebarModel } from '#features/sidebar/api.ts'
import { usePinTeam } from '#features/views/api.ts'
import { copyLinkItem, menuEntries, openInNewTabItem, separator } from '#lib/row-menu.ts'
import { toast } from '#lib/toast.ts'

type TeamPage =
  | '/$workspace/$team'
  | '/$workspace/$team/triage'
  | '/$workspace/$team/baselines'
  | '/$workspace/$team/sites'
  | '/$workspace/$team/settings'

/**
 * A team's right-click menu, on its sidebar entry and its row of the Teams page. Pin and Team
 * settings read the sidebar model (cached): the pin state, whether there are Sites, and whether
 * the person may change the workspace's settings and its teams'. Team settings is one of the
 * entry points into settings (CLAUDE.md, "Settings is a closed area"), shown to the same people
 * as the team page's Settings button.
 */
export function TeamContextMenu({
  workspace,
  team,
  pages = false,
  children,
}: TeamContextMenu.Props) {
  const router = useRouter()
  const { data: model } = useSidebarModel(workspace)
  const pin = usePinTeam(workspace, team)
  const entry = model?.teams.find((t) => t.slug === team)
  const params = { workspace, team }
  const builds = router.buildLocation({ to: '/$workspace/$team', params }).href
  const go = (to: TeamPage) => () => void router.navigate({ to, params })
  const pinned = entry?.pinned
  const canManage = model?.canManage === true
  return (
    <ContextMenu
      items={menuEntries([
        { label: pages ? 'Open builds' : 'Open', onSelect: go('/$workspace/$team') },
        pages && { label: 'Open triage', onSelect: go('/$workspace/$team/triage') },
        pages && { label: 'Open baselines', onSelect: go('/$workspace/$team/baselines') },
        pages &&
          (entry?.siteCount ?? 0) > 0 && {
            label: 'Open sites',
            onSelect: go('/$workspace/$team/sites'),
          },
        openInNewTabItem(builds),
        copyLinkItem(builds),
        pinned !== undefined && separator,
        pinned !== undefined && {
          label: pinned ? 'Unpin team' : 'Pin team',
          // Undo is the exact inverse: pin it the way it was (as the team page's button does).
          onSelect: () =>
            pin.mutate(!pinned, {
              onSuccess: () =>
                toast.undoable(pinned ? 'Unpinned team' : 'Pinned team', () =>
                  pin.mutateAsync(pinned),
                ),
            }),
        },
        canManage && separator,
        canManage && { label: 'Team settings', onSelect: go('/$workspace/$team/settings') },
      ])}
    >
      {children}
    </ContextMenu>
  )
}

export namespace TeamContextMenu {
  export interface Props {
    workspace: string
    team: string
    /** Also offers the team's Triage, Baselines and Sites (the sidebar's entry; the Teams page's row opens the team). */
    pages?: boolean
    children: ReactNode
  }
}
