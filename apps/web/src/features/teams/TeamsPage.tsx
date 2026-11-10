import {
  Avatar,
  Banner,
  Button,
  ListRow,
  NoResults,
  PlusIcon,
  StatusIcon,
  Text,
  visuallyHidden,
} from '@circi/ui'
import { useQuery } from '@tanstack/react-query'

import { buildState } from '#features/builds/build-state.ts'
import { integrationsQuery } from '#features/integrations/api/index.ts'
import { useWorkspaces } from '#features/sidebar/use-workspaces.ts'
import { capabilitiesQuery, teamsQuery } from '#features/teams/api/index.ts'
import { useDocumentTitle } from '#lib/document-title.ts'
import { findIn, useFindParam } from '#lib/find.ts'
import { FindField } from '#lib/FindField.tsx'
import { PageHeading } from '#lib/PageHeading.tsx'
import { QueryBoundary } from '#lib/QueryBoundary.tsx'
import { RelativeTime } from '#lib/RelativeTime.tsx'
import { useOverlayStore } from '#lib/stores/overlay-store.ts'
import { useChosenWorkspace } from '#lib/stores/workspace-store.ts'
import { useClientLink } from '#lib/use-client-link.ts'

import { MemberStack } from './AvatarStack.tsx'
import { changesCell } from './list.ts'
import { TeamsEmpty } from './TeamsEmpty.tsx'

import styles from './TeamsPage.module.css'

const ACCEPTS_TEXT = {
  email: 'an email code',
  password: 'a password',
  github: 'GitHub',
  google: 'Google',
} as const

export function TeamsPage() {
  useDocumentTitle('Teams')
  const clientLink = useClientLink()
  const query = useQuery(teamsQuery())
  const { data: caps } = useQuery(capabilitiesQuery())
  const setNewTeamOpen = useOverlayStore((s) => s.setNewTeamOpen)
  const setImportOpen = useOverlayStore((s) => s.setImportOpen)
  const canCreateTeam = (caps?.manageableWorkspaces.length ?? 0) > 0
  const canCreateWorkspace = caps?.canCreateWorkspace === true
  // The teams of the workspace the shell is about (the board lists one workspace's teams); the
  // workspace switcher is how to see another's.
  const { workspace } = useWorkspaces(useChosenWorkspace())
  const teams = query.data?.teams.filter((o) => o.workspace.slug === workspace?.slug)
  // Import from GitHub needs a GitHub App installation in this workspace, and an owner or admin.
  const canManage = caps?.manageableWorkspaces.some((w) => w.slug === workspace?.slug) === true
  const { data: integrations } = useQuery({
    ...integrationsQuery(workspace?.slug ?? ''),
    enabled: canManage && workspace !== undefined,
  })
  const [find, setFind] = useFindParam()
  const shown = findIn(teams ?? [], find, (o) => [
    o.team.name,
    o.team.slug,
    `${o.workspace.slug}/${o.team.slug}`,
  ])
  const canImport =
    canManage && integrations?.integrations.some((i) => i.kind === 'github') === true

  return (
    <>
      <PageHeading
        title="Teams"
        after={
          teams ? (
            <Text variant="small" tone="tertiary" aria-label={`${teams.length} teams`}>
              {teams.length}
            </Text>
          ) : null
        }
        find={
          teams && teams.length > 0 ? (
            <FindField noun="teams" value={find} onChange={setFind} />
          ) : null
        }
        actions={
          <>
            {canCreateTeam ? (
              <>
                {canImport ? (
                  <Button onClick={() => setImportOpen(true)}>Import from GitHub</Button>
                ) : null}
                <Button
                  variant="primary"
                  leading={<PlusIcon size={14} />}
                  onClick={() => setNewTeamOpen(true)}
                >
                  New team
                </Button>
              </>
            ) : null}
          </>
        }
      />
      <div className={styles.content}>
        {caps?.refusingWorkspaces.map((o) => (
          <Banner key={o.name}>
            {o.name} only shows its teams to people who signed in with{' '}
            {o.accepts.length > 0
              ? o.accepts.map((m) => ACCEPTS_TEXT[m]).join(' or ')
              : 'another method'}
            . Sign out and sign in that way to see them.
          </Banner>
        ))}
        <QueryBoundary query={query} announce="Loading teams" rows={3}>
          {() =>
            !teams || teams.length === 0 ? (
              <TeamsEmpty
                canCreateTeam={canCreateTeam}
                canCreateWorkspace={canCreateWorkspace}
                hasWorkspace={workspace !== undefined}
              />
            ) : (
              <>
                <div className={styles.head} aria-hidden="true">
                  <span className={styles.nameCol}>Name</span>
                  <span className={styles.members}>Members</span>
                  <span className={styles.latest}>Latest build</span>
                  <span className={styles.changes}>Changes</span>
                  <span className={styles.updated}>Updated</span>
                </div>
                {shown.length === 0 ? (
                  <NoResults noun="team" query={find} onClear={() => setFind('')} />
                ) : null}
                <ul aria-label="Teams" className={styles.list}>
                  {shown.map(({ workspace: owner, team, latestBuild }) => {
                    const state = latestBuild ? buildState(latestBuild) : null
                    const cell = latestBuild ? changesCell(latestBuild) : null
                    return (
                      <li key={`${owner.slug}/${team.slug}`}>
                        <ListRow
                          className={styles.row}
                          {...clientLink({
                            to: '/$workspace/$team',
                            params: { workspace: owner.slug, team: team.slug },
                          })}
                        >
                          <span className={styles.grid}>
                            <span className={styles.nameCol}>
                              <Avatar
                                type="team"
                                aria-hidden
                                slug={team.slug}
                                name={team.name}
                                color={team.color}
                                icon={team.icon}
                                size={24}
                              />
                              <span className={styles.names}>
                                <span className={styles.title}>{team.name}</span>
                                <span className={styles.subtitle}>
                                  {owner.slug}/{team.slug}
                                </span>
                              </span>
                            </span>
                            <span className={styles.members}>
                              <MemberStack count={team.memberCount} people={team.memberPreview} />
                            </span>
                            <span className={styles.latest}>
                              {latestBuild && state ? (
                                <>
                                  <StatusIcon status={state.status} label={state.label} />
                                  <span>#{latestBuild.number}</span>
                                  {latestBuild.branch ? (
                                    <span className={styles.branch}>{latestBuild.branch}</span>
                                  ) : null}
                                </>
                              ) : (
                                <>
                                  <StatusIcon status="neutral" label="No builds yet" />
                                  <Text variant="small" tone="secondary">
                                    No builds yet
                                  </Text>
                                </>
                              )}
                            </span>
                            <span className={styles.changes}>
                              {cell?.kind === 'counts' ? (
                                <span className={styles.counts}>
                                  {cell.counts.map((c) => (
                                    <span key={c.glyph} title={c.title}>
                                      <span aria-hidden="true">
                                        {c.glyph}
                                        {c.count}
                                      </span>
                                      <span style={visuallyHidden}>{c.title}</span>
                                    </span>
                                  ))}
                                </span>
                              ) : cell ? (
                                <Text variant="small" tone="tertiary">
                                  {cell.text}
                                </Text>
                              ) : null}
                            </span>
                            <span className={styles.updated}>
                              {latestBuild ? (
                                <Text variant="small" tone="tertiary">
                                  <RelativeTime iso={latestBuild.createdAt} />
                                </Text>
                              ) : null}
                            </span>
                          </span>
                        </ListRow>
                      </li>
                    )
                  })}
                </ul>
                <section className={styles.connect} aria-labelledby="teams-connect">
                  <p id="teams-connect" className={styles.connectTitle}>
                    Connect a CI job
                  </p>
                  <Text as="p" variant="small" tone="secondary">
                    Each team gets a token. Upload screenshots after your tests run and CirCI
                    compares them with the default branch.
                  </Text>
                  <pre className={styles.code}>npx circi upload ./screenshots --wait</pre>
                </section>
              </>
            )
          }
        </QueryBoundary>
      </div>
    </>
  )
}
