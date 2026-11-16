import { Avatar, Badge, Button, EmptyState, LayersIcon, PlusIcon } from '@circi/ui'
import { useQuery } from '@tanstack/react-query'
import { useParams } from '@tanstack/react-router'

import { capabilitiesQuery, projectsQuery } from '#features/projects/api/index.ts'
import { MemberStack } from '#features/projects/AvatarStack.tsx'
import { settingsCrumbsFor, workspaceSettingsCrumb } from '#lib/crumbs.ts'
import { useDocumentTitle } from '#lib/document-title.ts'
import { useFindParam } from '#lib/find.ts'
import { SettingsList, SettingsListPage, SettingsListRow } from '#lib/SettingsListPage.tsx'
import { useOverlayStore } from '#lib/stores/overlay-store.ts'

import { findProjects } from './projects-list.ts'

/**
 * Workspace settings, Projects (the canvas's SettingsProjects board): every project of the workspace the
 * person can see, with its people and whether they are in it. A row opens the project's settings
 * (its settings hub, which lists the pages the person has). Owners and
 * admins create projects here.
 */
export function ProjectsSettingsPage() {
  const { workspace } = useParams({ from: '/workspaces/$workspace/settings/projects' })
  useDocumentTitle('Projects', workspace)
  const query = useQuery(projectsQuery())
  const { data: caps } = useQuery(capabilitiesQuery())
  const setNewProjectOpen = useOverlayStore((s) => s.setNewProjectOpen)
  const [search, setSearch] = useFindParam()
  const canManage = caps?.manageableWorkspaces.some((w) => w.slug === workspace) === true
  const inWorkspace = (query.data?.projects ?? []).filter((o) => o.workspace.slug === workspace)
  const shown = findProjects(inWorkspace, search)

  return (
    <SettingsListPage
      crumbs={settingsCrumbsFor(
        { slug: workspace, name: inWorkspace[0]?.workspace.name ?? workspace },
        [workspaceSettingsCrumb(workspace)],
      )}
      title="Projects"
      noun="projects"
      singular="project"
      search={search}
      onSearch={setSearch}
      count={shown.length}
      actions={
        canManage ? (
          <Button
            variant="primary"
            leading={<PlusIcon size={14} />}
            onClick={() => setNewProjectOpen(true)}
          >
            New project
          </Button>
        ) : undefined
      }
      loading={query.isPending}
      error={query.error}
      onRetry={() => void query.refetch()}
      empty={
        <EmptyState icon={<LayersIcon />} size="section" title="No projects yet">
          {canManage
            ? 'Create a project to start uploading screenshots.'
            : 'Ask an owner or admin to create one.'}
        </EmptyState>
      }
    >
      <SettingsList label="Projects">
        {shown.map(({ project, workspace: owner }) => (
          <SettingsListRow
            key={project.slug}
            link={{
              to: '/$workspace/$project/settings',
              params: { workspace: owner.slug, project: project.slug },
            }}
            leading={
              <Avatar
                type="project"
                aria-hidden
                slug={project.slug}
                name={project.name}
                color={project.color}
                icon={project.icon}
                size={24}
              />
            }
            name={project.name}
            detail={`${owner.slug}/${project.slug}`}
            trailing={
              <>
                <MemberStack count={project.memberCount} people={project.memberPreview} />
                <Badge shape="tag">{project.youAreMember ? 'Member' : 'Not a member'}</Badge>
              </>
            }
          />
        ))}
      </SettingsList>
    </SettingsListPage>
  )
}
