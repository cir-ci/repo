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

import { capabilitiesQuery } from '#features/projects/api/index.ts'
import { useCrumbNames } from '#features/projects/crumb-names.ts'
import { useDocumentTitle } from '#lib/document-title.ts'
import { crumbsFor, PageHeading } from '#lib/PageHeading.tsx'
import { QueryBoundary } from '#lib/QueryBoundary.tsx'
import { RelativeTime } from '#lib/RelativeTime.tsx'
import { copiedToast } from '#lib/toast.ts'

import { formatSize, projectsitesQuery } from './api.ts'
import { CustomDomainSection } from './CustomDomainSection.tsx'

import styles from './ProjectsitesPage.module.css'

const UPLOAD_EXAMPLE =
  'CIRCI_TOKEN=… CIRCI_API_URL=… \\\n  npx circi storybook upload ./storybook-static'

/**
 * A project's hosted sites: each branch's current address, and recent uploads by commit. The
 * dashboard only links out; the sites are served from their own domain and ask you to sign in.
 */
export function ProjectsitesPage() {
  const { workspace, project } = useParams({ from: '/$workspace/$project/sites' })
  useDocumentTitle('Sites', project)
  const names = useCrumbNames(workspace, project)
  return (
    <>
      <PageHeading crumbs={crumbsFor(names)} title="Sites" />
      <ProjectsitesBody workspace={workspace} project={project} />
    </>
  )
}

/** The sites themselves, shared by this page and the Sites tab of the project's settings. */
export function ProjectsitesBody({ workspace, project }: ProjectsitesBody.Props) {
  const query = useQuery(projectsitesQuery(workspace, project))
  const caps = useQuery(capabilitiesQuery())
  const canChangeServer = caps.data?.instanceAdmin === true

  return (
    <>
      <div className={styles.content}>
        <QueryBoundary query={query} notFound="This project doesn't exist" rows={3}>
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
                    project={project}
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

export namespace ProjectsitesBody {
  export interface Props {
    workspace: string
    project: string
  }
}
