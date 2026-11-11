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

import { removalText } from '#features/project-settings/members-model.ts'
import { useRemoveProjectMember } from '#features/projects/api/members.ts'
import { useSidebarModel } from '#features/sidebar/api.ts'
import { usePinProject } from '#features/views/api.ts'
import { authClient } from '#lib/auth-client.ts'
import { copyLinkItem, menuEntries, openInNewTabItem, separator } from '#lib/row-menu.ts'
import { toast } from '#lib/toast.ts'

type ProjectPage =
  | '/$workspace/$project'
  | '/$workspace/$project/triage'
  | '/$workspace/$project/baselines'
  | '/$workspace/$project/sites'
  | '/$workspace/$project/settings'

/**
 * A project's right-click menu, on its sidebar entry and its row of the Projects page. Pin and Project
 * settings read the sidebar model (cached): the pin state, whether there are Sites, and whether
 * the person may change the workspace's settings and its projects'. Project settings is one of the
 * entry points into settings (CLAUDE.md, "Settings is a closed area"), shown to the same people
 * as the project page's Settings button.
 */
export function ProjectContextMenu({ workspace, project, children }: ProjectContextMenu.Props) {
  const router = useRouter()
  const { data: model } = useSidebarModel(workspace)
  const pin = usePinProject(workspace, project)
  const leave = useRemoveProjectMember(workspace, project)
  const { data: session } = authClient.useSession()
  const [leaving, setLeaving] = useState(false)
  const entry = model?.projects.find((t) => t.slug === project)
  const params = { workspace, project }
  const builds = router.buildLocation({ to: '/$workspace/$project', params }).href
  const go = (to: ProjectPage) => () => void router.navigate({ to, params })
  const pinned = entry?.pinned
  const canManage = model?.canManage === true
  const name = entry?.name ?? project
  const me = session?.user.id
  const dialog = removalText(name, { name: session?.user.name ?? '', you: true })
  return (
    <>
      <ContextMenu
        items={menuEntries([
          // The project's pages, as a row of icons: Builds, Triage, Baselines, and Sites when it has some.
          {
            type: 'icon-row',
            name: `${name} pages`,
            items: [
              { label: 'Builds', icon: <HammerIcon />, onSelect: go('/$workspace/$project') },
              {
                label: 'Triage',
                icon: <ListChecksIcon />,
                onSelect: go('/$workspace/$project/triage'),
              },
              {
                label: 'Baselines',
                icon: <ImageIcon />,
                onSelect: go('/$workspace/$project/baselines'),
              },
              ...((entry?.siteCount ?? 0) > 0
                ? [
                    {
                      label: 'Sites',
                      icon: <GlobeIcon />,
                      onSelect: go('/$workspace/$project/sites'),
                    },
                  ]
                : []),
            ],
          },
          separator,
          openInNewTabItem(builds),
          copyLinkItem(builds),
          pinned !== undefined && separator,
          pinned !== undefined && {
            label: pinned ? 'Unpin project' : 'Pin project',
            // Undo is the exact inverse: pin it the way it was (as the project page's button does).
            onSelect: () =>
              pin.mutate(!pinned, {
                onSuccess: () =>
                  toast.undoable(pinned ? 'Unpinned project' : 'Pinned project', () =>
                    pin.mutateAsync(pinned),
                  ),
              }),
          },
          canManage && separator,
          canManage && { label: 'Project settings', onSelect: go('/$workspace/$project/settings') },
          // Leaving can't be undone by you (an owner or admin adds you back): it asks first.
          entry?.youAreMember === true && me !== undefined && separator,
          entry?.youAreMember === true &&
            me !== undefined && {
              label: 'Leave project',
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
              // You may no longer see the project: leave its pages for the list of projects.
              if (router.state.location.pathname.startsWith(`/${workspace}/${project}`))
                void router.navigate({ to: '/' })
            },
            onError: () => setLeaving(false),
          })
        }}
      />
    </>
  )
}

export namespace ProjectContextMenu {
  export interface Props {
    workspace: string
    project: string
    children: ReactNode
  }
}
