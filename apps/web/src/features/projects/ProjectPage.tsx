import {
  Banner,
  Button,
  CollectionsIcon,
  Delayed,
  EmptyState,
  ListRow,
  ListSkeleton,
  PanelHeader,
  Ref,
  SectionHeader,
  StatusIcon,
  Surface,
  Text,
} from '@circi/ui'
import { useQuery } from '@tanstack/react-query'
import { useParams, useSearch } from '@tanstack/react-router'

import { useDocumentTitle } from '../../lib/document-title.ts'
import { ErrorState } from '../../lib/ErrorState.tsx'
import { useClientLink } from '../../lib/use-client-link.ts'
import { buildState } from '../builds/build-state.ts'
import { BuildMeta } from '../builds/BuildMeta.tsx'
import { CountsSummary } from '../builds/CountsSummary.tsx'
import { shotReview } from '../builds/diff-status.ts'
import { BUILDS_PAGE_SIZE, flakyQuery, projectQuery } from './api.ts'
import { GitAttentionBanner } from './GitAttentionBanner.tsx'
import { useLoadingAnnouncement } from './loading.ts'
import { ProjectBreadcrumbs } from './ProjectBreadcrumbs.tsx'

import styles from './ProjectPage.module.css'

export function ProjectPage() {
  const { org, project } = useParams({ from: '/$org/$project' })
  const { before } = useSearch({ from: '/$org/$project' })
  const clientLink = useClientLink()
  const { data, error, refetch } = useQuery(projectQuery(org, project, before))
  const { data: flaky } = useQuery(flakyQuery(org, project))
  useDocumentTitle(before ? 'Older builds' : 'Builds', data?.project.name ?? project)
  useLoadingAnnouncement(!data && !error, 'Loading builds')

  const builds = data?.builds ?? []
  const oldest = builds.at(-1)?.number

  return (
    <>
      <PanelHeader
        actions={
          <>
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
      <div className={styles['content']}>
        {data ? (
          <Text as="p" variant="small" tone="secondary" className={styles['intro']}>
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
        <SectionHeader title={before ? 'Older builds' : 'Builds'} />
        {error ? (
          <ErrorState
            error={error}
            onRetry={() => void refetch()}
            notFound="This project doesn’t exist"
          />
        ) : !data ? (
          <Delayed>
            <ListSkeleton />
          </Delayed>
        ) : builds.length === 0 ? (
          <EmptyState
            icon={<CollectionsIcon size={32} />}
            title={before ? 'No older builds' : 'No builds yet'}
            action={
              before ? undefined : (
                <Surface variant="raised" className={styles['command']}>
                  <Text as="code" variant="mono">
                    {`CIRCI_TOKEN=… CIRCI_API_URL=${window.location.origin} \\\n  npx circi upload ./screenshots --wait`}
                  </Text>
                </Surface>
              )
            }
          >
            {before
              ? undefined
              : 'Upload screenshots from your CI job. Builds appear here as soon as they’re processed.'}
          </EmptyState>
        ) : (
          <>
            <ul aria-label="Builds" className={styles['list']}>
              {builds.map((b) => {
                const state = buildState(b)
                return (
                  <li key={b.id}>
                    <ListRow
                      className={styles['row']}
                      {...clientLink({
                        to: '/$org/$project/builds/$number',
                        params: { org, project, number: String(b.number) },
                      })}
                      leading={<StatusIcon status={state.status} label={state.label} />}
                      trailing={
                        <span className={styles['trailing']}>
                          <CountsSummary
                            counts={b.counts}
                            review={shotReview(b)}
                            includeUnchanged={false}
                          />
                        </span>
                      }
                    >
                      <span className={styles['title']}>
                        Build #{b.number}
                        {b.name !== 'default' ? (
                          <span className={styles['name']}> · {b.name}</span>
                        ) : null}
                      </span>
                      <div className={styles['meta']}>
                        <BuildMeta build={b} />
                      </div>
                    </ListRow>
                  </li>
                )
              })}
            </ul>
            {/* Primer: pagination sits directly below the collection it pages. */}
            <div className={styles['pager']}>
              {before ? (
                <Button
                  {...clientLink({ to: '/$org/$project', params: { org, project }, search: {} })}
                >
                  Newest builds
                </Button>
              ) : null}
              {builds.length === BUILDS_PAGE_SIZE && oldest ? (
                <Button
                  {...clientLink({
                    to: '/$org/$project',
                    params: { org, project },
                    search: { before: oldest },
                  })}
                >
                  Older builds
                </Button>
              ) : null}
            </div>
          </>
        )}
      </div>
    </>
  )
}
