import { flakyReasonText } from '@circi/core'
import { Banner, Button, Link, Avatar, Text, Tooltip } from '@circi/ui'
import { useQuery } from '@tanstack/react-query'
import { useNavigate, useParams, useSearch } from '@tanstack/react-router'

import {
  type BuildFilters,
  hasFilters,
  parseBuildsSearch,
  toSearch,
} from '#features/builds/list/builds-filters.ts'
import { BuildsBrowser } from '#features/builds/list/BuildsBrowser.tsx'
import { BuildsFind } from '#features/builds/list/BuildsFind.tsx'
import { GitAttentionBanner } from '#features/builds/list/GitAttentionBanner.tsx'
import { flakyQuery, projectQuery } from '#features/projects/api/index.ts'
import { useSidebarModel } from '#features/sidebar/api.ts'
import { useDocumentTitle } from '#lib/document-title.ts'
import { crumbsFor, PageHeading } from '#lib/PageHeading.tsx'
import { useDisplayStore } from '#lib/stores/display-store.ts'
import { useClientLink } from '#lib/use-client-link.ts'

import styles from './ProjectPage.module.css'

export function ProjectPage() {
  const { workspace, project } = useParams({ from: '/$workspace/$project' })
  const search = parseBuildsSearch(useSearch({ from: '/$workspace/$project' }))
  const { before, ...filters } = search
  const clientLink = useClientLink()
  const navigate = useNavigate()
  const order = useDisplayStore((s) => s.display.order)
  // The header (the project's name, its avatar, the banner) stays while a new filter's list loads:
  // without the previous data it blanked and came back, and the page jumped. Another project's
  // data is no placeholder.
  const { data } = useQuery({
    ...projectQuery(workspace, project, before, filters, order),
    placeholderData: (previous) => (previous?.project.slug === project ? previous : undefined),
  })
  const { data: flaky } = useQuery(flakyQuery(workspace, project))
  const { data: sidebar } = useSidebarModel(workspace)
  // Pinning and the project's settings are in its right-click menu (and the sidebar's), not here.
  const sidebarProject = sidebar?.projects.find((p) => p.slug === project)
  const siteCount = sidebarProject?.siteCount ?? 0
  useDocumentTitle(before ? 'Older builds' : 'Builds', data?.project.name ?? project)

  const setFilters = (next: BuildFilters) =>
    void navigate({
      to: '/$workspace/$project',
      params: { workspace, project },
      search: toSearch(next),
      replace: true,
    })

  return (
    <>
      <PageHeading
        crumbs={crumbsFor({
          workspace: { slug: workspace, name: data?.project.workspaceName ?? workspace },
        })}
        title={data?.project.name ?? project}
        find={
          <BuildsFind
            filters={filters}
            onFiltersChange={setFilters}
            disabled={!data || (data.builds.length === 0 && !hasFilters(filters))}
          />
        }
        actions={
          <>
            {siteCount ? (
              <Button
                size="sm"
                {...clientLink({
                  to: '/$workspace/$project/sites',
                  params: { workspace, project },
                })}
              >
                Sites
              </Button>
            ) : null}
          </>
        }
      />
      <div className={styles.content}>
        {data ? (
          <div className={styles.identity}>
            <Avatar
              type="project"
              aria-hidden
              slug={data.project.slug}
              name={data.project.name}
              color={data.project.color}
              icon={data.project.icon}
              size={40}
            />
            <Text as="span" variant="body" className={styles.projectName}>
              {data.project.name}
            </Text>
          </div>
        ) : null}
        <GitAttentionBanner attention={data?.gitAttention} />
        {flaky && flaky.flaky.length > 0 ? (
          // One line (a phone's screen is short): the count and a way to Triage, which lists each
          // screenshot with its reason and where to ignore the part that changes.
          <Banner
            tone="flaky"
            action={
              <Link
                {...clientLink({
                  to: '/$workspace/$project/triage',
                  params: { workspace, project },
                })}
              >
                Open Triage
              </Link>
            }
          >
            <Tooltip
              content={`These change with no code change on ${data?.project.defaultBranch ?? 'the default branch'}: ${flaky.flaky
                .map((f) => `${f.name} (${flakyReasonText(f.reason, { inline: true })})`)
                .join(
                  ', ',
                )}. They are probably not stable (a clock, an animation, random content).`}
            >
              <strong>
                {flaky.flaky.length} flaky {flaky.flaky.length === 1 ? 'screenshot' : 'screenshots'}
              </strong>
            </Tooltip>
          </Banner>
        ) : null}
        <BuildsBrowser
          workspace={workspace}
          project={project}
          filters={filters}
          onFiltersChange={setFilters}
          before={before}
        />
      </div>
    </>
  )
}
