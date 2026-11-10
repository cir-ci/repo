import {
  Banner,
  CommandBlock,
  GlobeIcon,
  EmptyState,
  Heading,
  Link,
  ListRow,
  SectionHeader,
  Text,
} from '@circi/ui'
import { useQuery } from '@tanstack/react-query'
import { useParams } from '@tanstack/react-router'

import { capabilitiesQuery } from '#features/teams/api/index.ts'
import { useCrumbNames } from '#features/teams/crumb-names.ts'
import { useDocumentTitle } from '#lib/document-title.ts'
import { crumbsFor, PageHeading } from '#lib/PageHeading.tsx'
import { QueryBoundary } from '#lib/QueryBoundary.tsx'
import { RelativeTime } from '#lib/RelativeTime.tsx'
import { copiedToast } from '#lib/toast.ts'

import { formatSize, teamSitesQuery } from './api.ts'
import { CustomDomainSection } from './CustomDomainSection.tsx'

import styles from './TeamSitesPage.module.css'

const UPLOAD_EXAMPLE =
  'CIRCI_TOKEN=… CIRCI_API_URL=… \\\n  npx circi storybook upload ./storybook-static'

/**
 * A team's hosted sites: each branch's current address, and recent uploads by commit. The
 * dashboard only links out; the sites are served from their own domain and ask you to sign in.
 */
export function TeamSitesPage() {
  const { workspace, team } = useParams({ from: '/$workspace/$team/sites' })
  useDocumentTitle('Sites', team)
  const names = useCrumbNames(workspace, team)
  return (
    <>
      <PageHeading crumbs={crumbsFor(names)} title="Sites" />
      <TeamSitesBody workspace={workspace} team={team} />
    </>
  )
}

/** The sites themselves, shared by this page and the Sites tab of the team's settings. */
export function TeamSitesBody({ workspace, team }: TeamSitesBody.Props) {
  const query = useQuery(teamSitesQuery(workspace, team))
  const caps = useQuery(capabilitiesQuery())
  const canChangeServer = caps.data?.instanceAdmin === true

  return (
    <>
      <div className={styles.content}>
        <QueryBoundary query={query} notFound="This team doesn't exist" rows={3}>
          {(data) =>
            !data.configured ? (
              caps.isPending ? null : (
                <Banner tone="info">
                  {canChangeServer
                    ? "Static site hosting isn't set up on this server. Set STATIC_SITES_HOST to a separate domain to turn it on."
                    : "Static site hosting isn't set up on this server. Ask an instance admin to turn it on."}
                </Banner>
              )
            ) : data.sites.length === 0 ? (
              <EmptyState
                icon={<GlobeIcon />}
                title="No sites yet"
                action={<CommandBlock command={UPLOAD_EXAMPLE} onCopy={copiedToast('Command')} />}
              >
                Upload a built Storybook or report from CI.
              </EmptyState>
            ) : (
              data.sites.map((site) => (
                <section key={site.slug} className={styles.site}>
                  <SectionHeader title={site.name} description={site.kindLabel} />
                  <CustomDomainSection
                    workspace={workspace}
                    team={team}
                    site={site}
                    dnsTarget={data.dnsTarget}
                    canManage={data.canManage}
                  />
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

export namespace TeamSitesBody {
  export interface Props {
    workspace: string
    team: string
  }
}
