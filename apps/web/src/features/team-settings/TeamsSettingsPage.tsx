import {
  Avatar,
  Badge,
  Button,
  ChevronRightIcon,
  EmptyState,
  LayersIcon,
  ListRow,
  NoResults,
  PlusIcon,
  Text,
} from '@circi/ui'
import { useQuery } from '@tanstack/react-query'
import { useParams } from '@tanstack/react-router'

import { capabilitiesQuery, teamsQuery } from '#features/teams/api/index.ts'
import { MemberStack } from '#features/teams/AvatarStack.tsx'
import { settingsCrumbsFor, workspaceSettingsCrumb } from '#lib/crumbs.ts'
import { useDocumentTitle } from '#lib/document-title.ts'
import { useFindParam } from '#lib/find.ts'
import { FindField } from '#lib/FindField.tsx'
import { PageFrame } from '#lib/PageFrame.tsx'
import { useOverlayStore } from '#lib/stores/overlay-store.ts'
import { useClientLink } from '#lib/use-client-link.ts'

import { findTeams } from './teams-list.ts'

import styles from './TeamsSettingsPage.module.css'

/**
 * Workspace settings, Teams (the canvas's SettingsTeams board): every team of the workspace the
 * person can see, with its people and whether they are in it. A row opens the team's settings
 * (its header and tabs); people who can't change settings land on its Members tab. Owners and
 * admins create teams here.
 */
export function TeamsSettingsPage() {
  const { workspace } = useParams({ from: '/workspaces/$workspace/settings/teams' })
  useDocumentTitle('Teams', workspace)
  const clientLink = useClientLink()
  const query = useQuery(teamsQuery())
  const { data: caps } = useQuery(capabilitiesQuery())
  const setNewTeamOpen = useOverlayStore((s) => s.setNewTeamOpen)
  const [search, setSearch] = useFindParam()
  const canManage = caps?.manageableWorkspaces.some((w) => w.slug === workspace) === true
  const inWorkspace = (query.data?.teams ?? []).filter((o) => o.workspace.slug === workspace)
  const shown = findTeams(inWorkspace, search)

  return (
    <PageFrame
      crumbs={settingsCrumbsFor(
        { slug: workspace, name: inWorkspace[0]?.workspace.name ?? workspace },
        [workspaceSettingsCrumb(workspace)],
      )}
      title="Teams"
      loading={query.isPending}
      error={query.error}
      onRetry={() => void query.refetch()}
    >
      <div className={styles.toolbar}>
        <FindField noun="teams" value={search} onChange={setSearch} />
        {canManage ? (
          <Button variant="primary" onClick={() => setNewTeamOpen(true)}>
            <PlusIcon size={14} />
            New team
          </Button>
        ) : null}
      </div>
      {shown.length === 0 && search.trim() ? (
        <NoResults noun="team" query={search} onClear={() => setSearch('')} size="section" />
      ) : shown.length === 0 ? (
        <EmptyState icon={<LayersIcon />} size="section" title="No teams yet">
          {canManage
            ? 'Create a team to start uploading screenshots.'
            : 'Ask an owner or admin to create one.'}
        </EmptyState>
      ) : (
        <ul aria-label="Teams" className={styles.list}>
          {shown.map(({ team, workspace: owner }) => (
            <li key={team.slug}>
              <ListRow
                {...clientLink({
                  to: canManage
                    ? '/$workspace/$team/settings'
                    : '/$workspace/$team/settings/members',
                  params: { workspace: owner.slug, team: team.slug },
                })}
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
                trailing={
                  <span className={styles.trailing}>
                    <MemberStack count={team.memberCount} people={team.memberPreview} />
                    <Badge shape="tag">{team.youAreMember ? 'Member' : 'Not a member'}</Badge>
                    <ChevronRightIcon size={12} />
                  </span>
                }
              >
                <span className={styles.names}>
                  <Text truncate>{team.name}</Text>
                  <Text variant="mono" tone="tertiary" truncate>
                    {owner.slug}/{team.slug}
                  </Text>
                </span>
              </ListRow>
            </li>
          ))}
        </ul>
      )}
    </PageFrame>
  )
}
