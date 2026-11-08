import { Banner, Button, Ref, TeamTile, Text, useAnnounce } from '@circi/ui'
import { useQuery } from '@tanstack/react-query'
import { useNavigate, useParams, useSearch } from '@tanstack/react-router'

import { useSidebarModel } from '#features/sidebar/api.ts'
import { usePinTeam } from '#features/views/api.ts'
import { useDocumentTitle } from '#lib/document-title.ts'
import { PageHeading, workspaceCrumb } from '#lib/PageHeading.tsx'
import { useClientLink } from '#lib/use-client-link.ts'

import { flakyQuery, teamQuery } from './api.ts'
import { isTeamColor, isTeamIconName } from './appearance.ts'
import { type BuildFilters, parseBuildsSearch, toSearch } from './builds-filters.ts'
import { BuildsBrowser } from './BuildsBrowser.tsx'
import { GitAttentionBanner } from './GitAttentionBanner.tsx'

import styles from './TeamPage.module.css'

export function TeamPage() {
  const { workspace, team } = useParams({ from: '/$workspace/$team' })
  const search = parseBuildsSearch(useSearch({ from: '/$workspace/$team' }))
  const { before, ...filters } = search
  const clientLink = useClientLink()
  const navigate = useNavigate()
  const announce = useAnnounce()
  const { data } = useQuery(teamQuery(workspace, team, before, filters))
  const { data: flaky } = useQuery(flakyQuery(workspace, team))
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
        crumbs={[
          { label: 'Teams', link: { to: '/' } },
          workspaceCrumb({ slug: workspace, name: data?.team.workspaceName ?? workspace }),
        ]}
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
            <Button
              size="sm"
              {...clientLink({ to: '/$workspace/$team/settings', params: { workspace, team } })}
            >
              Settings
            </Button>
          </>
        }
      />
      <div className={styles.content}>
        {data ? (
          <div className={styles.identity}>
            <TeamTile
              name={data.team.name}
              color={isTeamColor(data.team.color) ? data.team.color : 'slate'}
              {...(isTeamIconName(data.team.icon) ? { icon: data.team.icon } : {})}
              size={40}
            />
            <Text as="span" variant="body" className={styles.teamName}>
              {data.team.name}
            </Text>
          </div>
        ) : null}
        {data ? (
          <Text as="p" variant="small" tone="secondary" className={styles.intro}>
            Screenshot builds from CI. Builds on{' '}
            <Ref value={data.team.defaultBranch} label="default branch" /> become the baselines that
            pull requests are compared with.
          </Text>
        ) : null}
        <GitAttentionBanner attention={data?.gitAttention} />
        {flaky && flaky.flaky.length > 0 ? (
          <Banner
            tone="warning"
            title={`These screenshots keep changing on ${data?.team.defaultBranch ?? 'the default branch'}:`}
          >
            {flaky.flaky
              .map((f) => `${f.name} (${f.changedIn} of the last ${flaky.builds} builds)`)
              .join(', ')}
            . They are probably not stable (a clock, an animation, random content). Mask the part
            that changes with{' '}
            <Text as="code" variant="mono">
              circi admin ignore add
            </Text>
            .
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
