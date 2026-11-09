import {
  Banner,
  GlobeIcon,
  EmptyState,
  Heading,
  Link,
  ListRow,
  SectionHeader,
  Surface,
  Text,
} from '@circi/ui'
import { useQuery } from '@tanstack/react-query'
import { useParams } from '@tanstack/react-router'

import { useDocumentTitle } from '#lib/document-title.ts'
import { PageHeading, teamCrumb } from '#lib/PageHeading.tsx'
import { QueryBoundary } from '#lib/QueryBoundary.tsx'
import { RelativeTime } from '#lib/RelativeTime.tsx'

import { formatSize, teamSitesQuery } from './api.ts'

import styles from './TeamSitesPage.module.css'

const UPLOAD_EXAMPLE =
  'CIRCI_TOKEN=… CIRCI_API_URL=… \\\n  npx circi storybook upload ./storybook-static'

/**
 * A team's hosted sites: each branch's current address, and recent uploads by commit. The
 * dashboard only links out; the sites are served from their own domain and ask you to sign in.
 */
export function TeamSitesPage() {
  const { workspace, team } = useParams({ from: '/$workspace/$team/sites' })
  const query = useQuery(teamSitesQuery(workspace, team))
  useDocumentTitle('Sites', team)

  return (
    <>
      <PageHeading
        crumbs={[
          { label: 'Teams', link: { to: '/' } },
          teamCrumb(workspace, { slug: team, name: team }),
        ]}
        title="Sites"
      />
      <div className={styles.content}>
        <div className={styles.intro}>
          <Text as="p" tone="secondary">
            Storybook, test reports and other sites uploaded from CI. Opening one asks you to sign
            in on its own address.
          </Text>
        </div>
        <QueryBoundary query={query} notFound="This team doesn’t exist" rows={3}>
          {(data) =>
            !data.configured ? (
              <Banner tone="info">
                Static site hosting isn’t set up on this server. Set STATIC_SITES_HOST to a separate
                domain to turn it on.
              </Banner>
            ) : data.sites.length === 0 ? (
              <EmptyState
                icon={<GlobeIcon size={32} />}
                title="No sites yet"
                action={
                  <Surface variant="raised" className={styles.code}>
                    <Text as="code" variant="mono">
                      {UPLOAD_EXAMPLE}
                    </Text>
                  </Surface>
                }
              >
                Upload a built Storybook or report from CI. Hosting also has to be switched on in
                the team’s settings.
              </EmptyState>
            ) : (
              data.sites.map((site) => (
                <section key={site.slug} className={styles.site}>
                  <SectionHeader title={site.name} description={site.kindLabel} />
                  {site.branches.length > 0 ? (
                    <div className={styles.group}>
                      <Heading level="heading">
                        Branches{' '}
                        <Text variant="micro" tone="tertiary">
                          {site.branches.length}
                        </Text>
                      </Heading>
                      <div className={styles.list}>
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
                  <div className={styles.group}>
                    <Heading level="heading">
                      Uploads{' '}
                      <Text variant="micro" tone="tertiary">
                        {site.versions.length}
                      </Text>
                    </Heading>
                    <div className={styles.list}>
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
            )
          }
        </QueryBoundary>
      </div>
    </>
  )
}
