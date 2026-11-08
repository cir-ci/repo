import {
  Banner,
  Breadcrumbs,
  GlobeIcon,
  Delayed,
  EmptyState,
  Heading,
  Link,
  ListRow,
  ListSkeleton,
  PanelHeader,
  SectionHeader,
  Surface,
  Text,
} from '@circi/ui'
import { useQuery } from '@tanstack/react-query'
import { useNavigate, useParams } from '@tanstack/react-router'

import { useDocumentTitle } from '../../lib/document-title.ts'
import { ErrorState } from '../../lib/ErrorState.tsx'
import { RelativeTime } from '../../lib/RelativeTime.tsx'
import { formatSize, projectSitesQuery } from './api.ts'

import styles from './ProjectSitesPage.module.css'

const UPLOAD_EXAMPLE =
  'CIRCI_TOKEN=… CIRCI_API_URL=… \\\n  npx circi storybook upload ./storybook-static'

/**
 * A project's hosted sites: each branch's current address, and recent uploads by commit. The
 * dashboard only links out; the sites are served from their own domain and ask you to sign in.
 */
export function ProjectSitesPage() {
  const { org, project } = useParams({ from: '/$org/$project/sites' })
  const navigate = useNavigate()
  const { data, error, refetch } = useQuery(projectSitesQuery(org, project))
  useDocumentTitle('Sites', project)

  return (
    <>
      <PanelHeader>
        <Breadcrumbs
          items={[
            {
              label: 'Projects',
              href: '/',
              onClick: (e) => {
                e.preventDefault()
                void navigate({ to: '/' })
              },
            },
            {
              label: project,
              href: `/${org}/${project}`,
              onClick: (e) => {
                e.preventDefault()
                void navigate({ to: '/$org/$project', params: { org, project } })
              },
            },
            { label: 'Sites' },
          ]}
        />
      </PanelHeader>
      <div className={styles['content']}>
        <div className={styles['intro']}>
          <Heading level="title" as="h1">{`${project} sites`}</Heading>
          <Text as="p" tone="secondary">
            Storybook, test reports and other sites uploaded from CI. Opening one asks you to sign
            in on its own address.
          </Text>
        </div>
        {error ? (
          <ErrorState
            error={error}
            onRetry={() => void refetch()}
            notFound="This project doesn’t exist"
          />
        ) : !data ? (
          <Delayed>
            <ListSkeleton rows={3} />
          </Delayed>
        ) : !data.configured ? (
          <Banner tone="info">
            Static site hosting isn’t set up on this server. Set STATIC_SITES_HOST to a separate
            domain to turn it on.
          </Banner>
        ) : data.sites.length === 0 ? (
          <EmptyState
            icon={<GlobeIcon size={32} />}
            title="No sites yet"
            action={
              <Surface variant="raised" className={styles['code']}>
                <Text as="code" variant="mono">
                  {UPLOAD_EXAMPLE}
                </Text>
              </Surface>
            }
          >
            Upload a built Storybook or report from CI. Hosting also has to be switched on in the
            project’s settings.
          </EmptyState>
        ) : (
          data.sites.map((site) => (
            <section key={site.slug} className={styles['site']}>
              <SectionHeader title={site.name} description={site.kindLabel} />
              {site.branches.length > 0 ? (
                <div className={styles['group']}>
                  <Heading level="heading">
                    Branches{' '}
                    <Text variant="micro" tone="tertiary">
                      {site.branches.length}
                    </Text>
                  </Heading>
                  <div className={styles['list']}>
                    {site.branches.map((b) => (
                      <ListRow key={b.address}>
                        <Text as="div" truncate>
                          <Link href={b.address} target="_blank" rel="noreferrer">
                            {b.branch}
                          </Link>
                        </Text>
                        <Text as="div" variant="small" tone="secondary">
                          commit {b.commitSha.slice(0, 7)} · updated{' '}
                          <RelativeTime iso={b.updatedAt} />
                        </Text>
                      </ListRow>
                    ))}
                  </div>
                </div>
              ) : null}
              <div className={styles['group']}>
                <Heading level="heading">
                  Uploads{' '}
                  <Text variant="micro" tone="tertiary">
                    {site.versions.length}
                  </Text>
                </Heading>
                <div className={styles['list']}>
                  {site.versions.map((v) => (
                    <ListRow key={v.commitSha}>
                      <Text as="div" variant="mono" truncate>
                        {v.address ? (
                          <Link href={v.address} target="_blank" rel="noreferrer">
                            {v.commitSha.slice(0, 7)}
                          </Link>
                        ) : (
                          v.commitSha.slice(0, 7)
                        )}
                      </Text>
                      <Text as="div" variant="small" tone="secondary">
                        {v.branch ? `${v.branch} · ` : ''}
                        {formatSize(v.totalBytes)} · <RelativeTime iso={v.createdAt} />
                      </Text>
                    </ListRow>
                  ))}
                </div>
              </div>
            </section>
          ))
        )}
      </div>
    </>
  )
}
