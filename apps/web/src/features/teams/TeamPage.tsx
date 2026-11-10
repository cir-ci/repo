import { Banner, Button, Link, TeamTile, Text, useAnnounce } from '@circi/ui'
import { useQuery } from '@tanstack/react-query'
import { useNavigate, useParams, useSearch } from '@tanstack/react-router'
import { Fragment } from 'react'

import { baselineLink } from '#features/baselines/links.ts'
import {
  type BuildFilters,
  parseBuildsSearch,
  toSearch,
} from '#features/builds/list/builds-filters.ts'
import { BuildsBrowser } from '#features/builds/list/BuildsBrowser.tsx'
import { GitAttentionBanner } from '#features/builds/list/GitAttentionBanner.tsx'
import { useSidebarModel } from '#features/sidebar/api.ts'
import { flakyQuery, settingsQuery, teamQuery } from '#features/teams/api/index.ts'
import { usePinTeam } from '#features/views/api.ts'
import { useDocumentTitle } from '#lib/document-title.ts'
import { crumbsFor, PageHeading } from '#lib/PageHeading.tsx'
import { useDisplayStore } from '#lib/stores/display-store.ts'
import { useClientLink } from '#lib/use-client-link.ts'

import { isTeamColor, isTeamIconName } from './appearance.ts'

import styles from './TeamPage.module.css'

export function TeamPage() {
  const { workspace, team } = useParams({ from: '/$workspace/$team' })
  const search = parseBuildsSearch(useSearch({ from: '/$workspace/$team' }))
  const { before, ...filters } = search
  const clientLink = useClientLink()
  const navigate = useNavigate()
  const announce = useAnnounce()
  const order = useDisplayStore((s) => s.display.order)
  const { data } = useQuery(teamQuery(workspace, team, before, filters, order))
  const { data: flaky } = useQuery(flakyQuery(workspace, team))
  // Only owners and admins reach the team's settings and add ignore regions (the settings are cached).
  const { data: settings } = useQuery(settingsQuery(workspace, team))
  const canManage = settings?.canManage === true
  const { data: sidebar } = useSidebarModel(workspace)
  const pin = usePinTeam(workspace, team)
  const pinned = sidebar?.teams.find((p) => p.slug === team)?.pinned
  useDocumentTitle(before ? 'Older builds' : 'Builds', data?.team.name ?? team)

  const setFilters = (next: BuildFilters) =>
    void navigate({
      to: '/$workspace/$team',
      params: { workspace, team },
      search: toSearch(next),
      replace: true,
    })

  return (
    <>
      <PageHeading
        crumbs={crumbsFor({
          workspace: { slug: workspace, name: data?.team.workspaceName ?? workspace },
        })}
        title={data?.team.name ?? team}
        actions={
          <>
            {pinned === undefined ? null : (
              <Button
                size="sm"
                loading={pin.isPending}
                onClick={() =>
                  pin.mutate(!pinned, {
                    onSuccess: () => announce(pinned ? 'Unpinned team' : 'Pinned team'),
                  })
                }
              >
                {pinned ? 'Unpin team' : 'Pin team'}
              </Button>
            )}
            <Button
              size="sm"
              {...clientLink({ to: '/$workspace/$team/sites', params: { workspace, team } })}
            >
              Sites
            </Button>
            {canManage ? (
              <Button
                size="sm"
                {...clientLink({ to: '/$workspace/$team/settings', params: { workspace, team } })}
              >
                Settings
              </Button>
            ) : null}
          </>
        }
      />
      <div className={styles.content}>
        {data ? (
          <div className={styles.identity}>
            <TeamTile
              name={data.team.name}
              seed={data.team.slug}
              color={isTeamColor(data.team.color) ? data.team.color : 'slate'}
              {...(isTeamIconName(data.team.icon) ? { icon: data.team.icon } : {})}
              size={40}
            />
            <Text as="span" variant="body" className={styles.teamName}>
              {data.team.name}
            </Text>
          </div>
        ) : null}
        <GitAttentionBanner attention={data?.gitAttention} />
        {flaky && flaky.flaky.length > 0 ? (
          <Banner
            tone="warning"
            title={`These screenshots keep changing on ${data?.team.defaultBranch ?? 'the default branch'}:`}
          >
            {flaky.flaky.map((f, index) => (
              <Fragment key={f.name}>
                {index > 0 ? ', ' : null}
                {canManage ? (
                  <Link {...clientLink(baselineLink(workspace, team, f.name))}>{f.name}</Link>
                ) : (
                  f.name
                )}{' '}
                ({f.changedIn} of the last {flaky.builds} builds)
              </Fragment>
            ))}
            . They are probably not stable (a clock, an animation, random content).{' '}
            {canManage
              ? 'Choose a screenshot to ignore the part that changes.'
              : 'Ask an owner or admin of this team to ignore the part that changes.'}
          </Banner>
        ) : null}
        <BuildsBrowser
          workspace={workspace}
          team={team}
          filters={filters}
          onFiltersChange={setFilters}
          before={before}
        />
      </div>
    </>
  )
}
