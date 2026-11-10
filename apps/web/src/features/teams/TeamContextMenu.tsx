import {
  ConfirmDialog,
  ContextMenu,
  GlobeIcon,
  HammerIcon,
  ImageIcon,
  ListChecksIcon,
} from '@circi/ui'
import { useRouter } from '@tanstack/react-router'
import { type ReactNode, useState } from 'react'

import { useSidebarModel } from '#features/sidebar/api.ts'
import { removalText } from '#features/team-settings/members-model.ts'
import { useRemoveTeamMember } from '#features/teams/api/members.ts'
import { usePinTeam } from '#features/views/api.ts'
import { authClient } from '#lib/auth-client.ts'
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
export function TeamContextMenu({ workspace, team, children }: TeamContextMenu.Props) {
  const router = useRouter()
  const { data: model } = useSidebarModel(workspace)
  const pin = usePinTeam(workspace, team)
  const leave = useRemoveTeamMember(workspace, team)
  const { data: session } = authClient.useSession()
  const [leaving, setLeaving] = useState(false)
  const entry = model?.teams.find((t) => t.slug === team)
  const params = { workspace, team }
  const builds = router.buildLocation({ to: '/$workspace/$team', params }).href
  const go = (to: TeamPage) => () => void router.navigate({ to, params })
  const pinned = entry?.pinned
  const canManage = model?.canManage === true
  const name = entry?.name ?? team
  const me = session?.user.id
  const dialog = removalText(name, { name: session?.user.name ?? '', you: true })
  return (
    <>
      <ContextMenu
        items={menuEntries([
          // The team's pages, as a row of icons: Builds, Triage, Baselines, and Sites when it has some.
          {
            type: 'icon-row',
            name: `${name} pages`,
            items: [
              { label: 'Builds', icon: <HammerIcon />, onSelect: go('/$workspace/$team') },
              {
                label: 'Triage',
                icon: <ListChecksIcon />,
                onSelect: go('/$workspace/$team/triage'),
              },
              {
                label: 'Baselines',
                icon: <ImageIcon />,
                onSelect: go('/$workspace/$team/baselines'),
              },
              ...((entry?.siteCount ?? 0) > 0
                ? [{ label: 'Sites', icon: <GlobeIcon />, onSelect: go('/$workspace/$team/sites') }]
                : []),
            ],
          },
          separator,
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
          // Leaving can't be undone by you (an owner or admin adds you back): it asks first.
          entry?.youAreMember === true && me !== undefined && separator,
          entry?.youAreMember === true &&
            me !== undefined && {
              label: 'Leave team',
              tone: 'danger',
              onSelect: () => setLeaving(true),
            },
        ])}
      >
        {children}
      </ContextMenu>
      <ConfirmDialog
        open={leaving}
        onOpenChange={setLeaving}
        title={dialog.title}
        description={dialog.text}
        confirmLabel={dialog.button}
        loading={leave.isPending}
        onConfirm={() => {
          if (me === undefined) return
          leave.mutate(me, {
            onSuccess: () => {
              toast(`You left ${name}`)
              setLeaving(false)
              // You may no longer see the team: leave its pages for the list of teams.
              if (router.state.location.pathname.startsWith(`/${workspace}/${team}`))
                void router.navigate({ to: '/' })
            },
            onError: () => setLeaving(false),
          })
        }}
      />
    </>
  )
}

export namespace TeamContextMenu {
  export interface Props {
    workspace: string
    team: string
    children: ReactNode
  }
}
