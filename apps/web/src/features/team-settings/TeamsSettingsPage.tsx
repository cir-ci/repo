import { Avatar, Badge, Button, EmptyState, LayersIcon, PlusIcon } from '@circi/ui'
import { useQuery } from '@tanstack/react-query'
import { useParams } from '@tanstack/react-router'

import { capabilitiesQuery, teamsQuery } from '#features/teams/api/index.ts'
import { MemberStack } from '#features/teams/AvatarStack.tsx'
import { WorkspaceBackLink } from '#features/workspace-settings/WorkspaceBackLink.tsx'
import { settingsCrumbsFor, workspaceSettingsCrumb } from '#lib/crumbs.ts'
import { useDocumentTitle } from '#lib/document-title.ts'
import { useFindParam } from '#lib/find.ts'
import { SettingsList, SettingsListPage, SettingsListRow } from '#lib/SettingsListPage.tsx'
import { useOverlayStore } from '#lib/stores/overlay-store.ts'

import { findTeams } from './teams-list.ts'

/**
 * Workspace settings, Teams (the canvas's SettingsTeams board): every team of the workspace the
 * person can see, with its people and whether they are in it. A row opens the team's settings
 * (its settings hub, which lists the pages the person has). Owners and
 * admins create teams here.
 */
export function TeamsSettingsPage() {
  const { workspace } = useParams({ from: '/workspaces/$workspace/settings/teams' })
  useDocumentTitle('Teams', workspace)
  const query = useQuery(teamsQuery())
  const { data: caps } = useQuery(capabilitiesQuery())
  const setNewTeamOpen = useOverlayStore((s) => s.setNewTeamOpen)
  const [search, setSearch] = useFindParam()
  const canManage = caps?.manageableWorkspaces.some((w) => w.slug === workspace) === true
  const inWorkspace = (query.data?.teams ?? []).filter((o) => o.workspace.slug === workspace)
  const shown = findTeams(inWorkspace, search)

  return (
    <SettingsListPage
      crumbs={settingsCrumbsFor(
        { slug: workspace, name: inWorkspace[0]?.workspace.name ?? workspace },
        [workspaceSettingsCrumb(workspace)],
      )}
      title="Teams"
      noun="teams"
      singular="team"
      search={search}
      onSearch={setSearch}
      count={shown.length}
      actions={
        canManage ? (
          <Button
            variant="primary"
            leading={<PlusIcon size={14} />}
            onClick={() => setNewTeamOpen(true)}
          >
            New team
          </Button>
        ) : undefined
      }
      loading={query.isPending}
      error={query.error}
      onRetry={() => void query.refetch()}
      back={
        <WorkspaceBackLink
          workspace={workspace}
          name={inWorkspace[0]?.workspace.name ?? workspace}
        />
      }
      empty={
        <EmptyState icon={<LayersIcon />} size="section" title="No teams yet">
          {canManage
            ? 'Create a team to start uploading screenshots.'
            : 'Ask an owner or admin to create one.'}
        </EmptyState>
      }
    >
      <SettingsList label="Teams">
        {shown.map(({ team, workspace: owner }) => (
          <SettingsListRow
            key={team.slug}
            link={{
              to: '/$workspace/$team/settings',
              params: { workspace: owner.slug, team: team.slug },
            }}
            leading={
              <Avatar
                type="team"
                aria-hidden
                slug={team.slug}
                name={team.name}
                color={team.color}
                icon={team.icon}
                size={24}
              />
            }
            name={team.name}
            detail={`${owner.slug}/${team.slug}`}
            trailing={
              <>
                <MemberStack count={team.memberCount} people={team.memberPreview} />
                <Badge shape="tag">{team.youAreMember ? 'Member' : 'Not a member'}</Badge>
              </>
            }
          />
        ))}
      </SettingsList>
    </SettingsListPage>
  )
}
