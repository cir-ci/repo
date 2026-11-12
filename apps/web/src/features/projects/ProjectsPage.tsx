import { Banner, Button, ListGroup, NoResults, PlusIcon, Text } from '@circi/ui'
import { useQuery } from '@tanstack/react-query'
import { Fragment } from 'react'

import { integrationsQuery } from '#features/integrations/api/index.ts'
import { capabilitiesQuery, projectsQuery } from '#features/projects/api/index.ts'
import { useWorkspaces } from '#features/sidebar/use-workspaces.ts'
import { useDocumentTitle } from '#lib/document-title.ts'
import { findIn, useFindParam } from '#lib/find.ts'
import { FindField } from '#lib/FindField.tsx'
import { PageHeading } from '#lib/PageHeading.tsx'
import { QueryBoundary } from '#lib/QueryBoundary.tsx'
import { useOverlayStore } from '#lib/stores/overlay-store.ts'
import { useChosenWorkspace } from '#lib/stores/workspace-store.ts'

import { groupByWorkspace } from './list.ts'
import { ProjectRow } from './ProjectRow.tsx'
import { ProjectsEmpty } from './ProjectsEmpty.tsx'

import styles from './ProjectsPage.module.css'

const ACCEPTS_TEXT = {
  email: 'an email code',
  password: 'a password',
  github: 'GitHub',
  google: 'Google',
} as const

/**
 * Every project you belong to, across workspaces: one group per workspace (its name as the group
 * header), or no group header at all with a single workspace. New project is the page's one primary
 * (its dialog asks which workspace); Import from GitHub belongs to a workspace, so it sits in the
 * header with one workspace and in each group's header with several.
 */
export function ProjectsPage() {
  useDocumentTitle('Projects')
  const query = useQuery(projectsQuery())
  const { data: caps } = useQuery(capabilitiesQuery())
  const setNewProjectOpen = useOverlayStore((s) => s.setNewProjectOpen)
  const canCreateProject = (caps?.manageableWorkspaces.length ?? 0) > 0
  const canCreateWorkspace = caps?.canCreateWorkspace === true
  const { workspace } = useWorkspaces(useChosenWorkspace())
  const projects = query.data?.projects
  const [find, setFind] = useFindParam()
  const shown = findIn(projects ?? [], find, (o) => [
    o.project.name,
    o.project.slug,
    `${o.workspace.slug}/${o.project.slug}`,
  ])
  const groups = groupByWorkspace(shown)
  const single = groupByWorkspace(projects ?? []).length === 1
  const onlyWorkspace = single ? projects?.[0]?.workspace.slug : undefined

  return (
    <>
      <PageHeading
        title="Projects"
        after={
          projects ? (
            <Text variant="small" tone="tertiary" aria-label={`${projects.length} projects`}>
              {projects.length}
            </Text>
          ) : null
        }
        find={
          <FindField
            noun="projects"
            value={find}
            onChange={setFind}
            disabled={!projects || projects.length === 0}
          />
        }
        actions={
          canCreateProject ? (
            <>
              {onlyWorkspace ? <ImportButton workspace={onlyWorkspace} /> : null}
              <Button
                variant="primary"
                leading={<PlusIcon size={14} />}
                onClick={() => setNewProjectOpen(true)}
              >
                New project
              </Button>
            </>
          ) : null
        }
      />
      <div className={styles.content}>
        {caps?.refusingWorkspaces.map((o) => (
          <Banner key={o.name}>
            {o.name} only shows its projects to people who signed in with{' '}
            {o.accepts.length > 0
              ? o.accepts.map((m) => ACCEPTS_TEXT[m]).join(' or ')
              : 'another method'}
            . Sign out and sign in that way to see them.
          </Banner>
        ))}
        <QueryBoundary query={query} announce="Loading projects" rows={3}>
          {() =>
            !projects || projects.length === 0 ? (
              <ProjectsEmpty
                canCreateProject={canCreateProject}
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
                  <NoResults noun="project" query={find} onClear={() => setFind('')} />
                ) : null}
                {groups.map((group) => {
                  const list = (
                    <ul
                      aria-label={single ? 'Projects' : `${group.workspace.name} projects`}
                      className={styles.list}
                    >
                      {group.projects.map((item) => (
                        <li key={`${item.workspace.slug}/${item.project.slug}`}>
                          <ProjectRow item={item} />
                        </li>
                      ))}
                    </ul>
                  )
                  if (single) return <Fragment key={group.workspace.slug}>{list}</Fragment>
                  const id = `projects-${group.workspace.slug}`
                  return (
                    <section key={group.workspace.slug} aria-labelledby={id}>
                      <div className={styles.groupHead}>
                        <ListGroup
                          id={id}
                          label={group.workspace.name}
                          count={group.projects.length}
                          countLabel={`${group.projects.length} projects`}
                          className={styles.groupLabel}
                        />
                        <ImportButton workspace={group.workspace.slug} size="sm" />
                      </div>
                      {list}
                    </section>
                  )
                })}
                <section className={styles.connect} aria-labelledby="projects-connect">
                  <p id="projects-connect" className={styles.connectTitle}>
                    Connect a CI job
                  </p>
                  <Text as="p" variant="small" tone="secondary">
                    Each project gets a token. Upload screenshots after your tests run and CirCI
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

/**
 * Import from GitHub into one workspace: only for owners and admins of it, and once it has a GitHub
 * App installation (the import lists that installation's repositories).
 */
function ImportButton({ workspace, size }: { workspace: string; size?: 'sm' }) {
  const { data: caps } = useQuery(capabilitiesQuery())
  const setImportWorkspace = useOverlayStore((s) => s.setImportWorkspace)
  const canManage = caps?.manageableWorkspaces.some((w) => w.slug === workspace) === true
  const { data: integrations } = useQuery({
    ...integrationsQuery(workspace),
    enabled: canManage,
  })
  if (!canManage || integrations?.integrations.some((i) => i.kind === 'github') !== true)
    return null
  return (
    <Button {...(size ? { size } : {})} onClick={() => setImportWorkspace(workspace)}>
      Import from GitHub
    </Button>
  )
}
