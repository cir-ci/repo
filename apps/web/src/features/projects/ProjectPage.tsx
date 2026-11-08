import { Banner, Button, PanelHeader, Ref, Text, useAnnounce } from '@circi/ui'
import { useQuery } from '@tanstack/react-query'
import { useNavigate, useParams, useSearch } from '@tanstack/react-router'

import { useSidebarModel } from '#features/sidebar/api.ts'
import { usePinProject } from '#features/views/api.ts'
import { useDocumentTitle } from '#lib/document-title.ts'
import { useClientLink } from '#lib/use-client-link.ts'

import { flakyQuery, projectQuery } from './api.ts'
import { type BuildFilters, parseBuildsSearch, toSearch } from './builds-filters.ts'
import { BuildsBrowser } from './BuildsBrowser.tsx'
import { GitAttentionBanner } from './GitAttentionBanner.tsx'
import { ProjectBreadcrumbs } from './ProjectBreadcrumbs.tsx'

import styles from './ProjectPage.module.css'

export function ProjectPage() {
  const { org, project } = useParams({ from: '/$org/$project' })
  const search = parseBuildsSearch(useSearch({ from: '/$org/$project' }))
  const { before, ...filters } = search
  const clientLink = useClientLink()
  const navigate = useNavigate()
  const announce = useAnnounce()
  const { data } = useQuery(projectQuery(org, project, before, filters))
  const { data: flaky } = useQuery(flakyQuery(org, project))
  const { data: sidebar } = useSidebarModel(org)
  const pin = usePinProject(org, project)
  const pinned = sidebar?.projects.find((p) => p.slug === project)?.pinned
  useDocumentTitle(before ? 'Older builds' : 'Builds', data?.project.name ?? project)

  const setFilters = (next: BuildFilters) =>
    void navigate({
      to: '/$org/$project',
      params: { org, project },
      search: toSearch(next),
      replace: true,
    })

  return (
    <>
      <PanelHeader
        actions={
          <>
            {pinned === undefined ? null : (
              <Button
                size="sm"
                loading={pin.isPending}
                onClick={() =>
                  pin.mutate(!pinned, {
                    onSuccess: () => announce(pinned ? 'Unpinned project' : 'Pinned project'),
                  })
                }
              >
                {pinned ? 'Unpin project' : 'Pin project'}
              </Button>
            )}
            <Button
              size="sm"
              {...clientLink({ to: '/$org/$project/sites', params: { org, project } })}
            >
              Sites
            </Button>
            <Button
              size="sm"
              {...clientLink({ to: '/$org/$project/settings', params: { org, project } })}
            >
              Settings
            </Button>
          </>
        }
      >
        <ProjectBreadcrumbs
          // The names only arrive with the data; the slugs keep the header from jumping.
          items={[
            { label: 'Projects', link: { to: '/' } },
            { label: data?.project.orgName ?? org },
            { label: data?.project.name ?? project },
          ]}
        />
      </PanelHeader>
      <div className={styles.content}>
        {data ? (
          <Text as="p" variant="small" tone="secondary" className={styles.intro}>
            Screenshot builds from CI. Builds on{' '}
            <Ref value={data.project.defaultBranch} label="default branch" /> become the baselines
            that pull requests are compared with.
          </Text>
        ) : null}
        <GitAttentionBanner attention={data?.gitAttention} />
        {flaky && flaky.flaky.length > 0 ? (
          <Banner
            tone="warning"
            title={`These screenshots keep changing on ${data?.project.defaultBranch ?? 'the default branch'}:`}
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
          org={org}
          project={project}
          filters={filters}
          onFiltersChange={setFilters}
          before={before}
        />
      </div>
    </>
  )
}
