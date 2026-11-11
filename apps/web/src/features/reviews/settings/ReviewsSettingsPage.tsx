import type { ReviewRule, Project } from '@circi/api'
import { Button, PlusIcon } from '@circi/ui'
import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { useParams } from '@tanstack/react-router'
import { useState } from 'react'

import { ProjectsettingsFrame } from '#features/project-settings/ProjectsettingsFrame.tsx'
import { projectMembersQuery } from '#features/projects/api/members.ts'
import { ErrorState } from '#lib/ErrorState.tsx'
import { QuerySkeleton } from '#lib/QueryBoundary.tsx'

import { rulesQuery } from './api.ts'
import { ReviewsForm } from './ReviewsForm.tsx'
import { RulesSection } from './RulesSection.tsx'

/** Project › Settings › Reviews and triage: who reviews what, how fast, and the triage rotation. */
export function ReviewsSettingsPage() {
  const { workspace, project } = useParams({ from: '/$workspace/$project/settings/reviews' })
  const rules = useQuery(rulesQuery(workspace, project))
  // The header's "Add rule" asks the rules list to open its dialog. The page has its own Save bar, so
  // this button is not a second primary.
  const [addRequests, setAddRequests] = useState(0)
  return (
    <ProjectsettingsFrame
      workspace={workspace}
      project={project}
      page="Reviews and triage"
      actions={
        rules.data?.canManage ? (
          <Button leading={<PlusIcon size={14} />} onClick={() => setAddRequests((n) => n + 1)}>
            Add rule
          </Button>
        ) : undefined
      }
    >
      {(settings) => (
        <Reviews
          workspace={workspace}
          project={project}
          settings={settings}
          rules={rules}
          addRequests={addRequests}
        />
      )}
    </ProjectsettingsFrame>
  )
}

function Reviews({ workspace, project, settings, rules, addRequests }: Reviews.Props) {
  // Rules, targets and the triage rotation draw their people from the project's members.
  const projectMembers = useQuery(projectMembersQuery(workspace, project))
  const people = (projectMembers.data?.members ?? []).map((m) => ({
    id: m.id,
    name: m.name,
    image: m.image,
  }))
  if (rules.error) return <ErrorState error={rules.error} onRetry={() => void rules.refetch()} />
  if (!rules.data) {
    return <QuerySkeleton />
  }
  const data = rules.data
  return (
    <>
      <RulesSection
        workspace={workspace}
        project={project}
        projectName={settings.settings.name}
        rules={data.rules}
        rotation={data.rotation}
        people={people}
        canManage={data.canManage}
        addRequests={addRequests}
      />
      <ReviewsForm
        workspace={workspace}
        project={project}
        settings={settings.settings}
        workspaceAssignOnCall={settings.workspace.assignTriageToOnCall}
        rotation={data.rotation}
        people={people}
        canManage={data.canManage}
      />
    </>
  )
}

namespace Reviews {
  export interface Props {
    workspace: string
    project: string
    settings: Project.SettingsResponse
    rules: UseQueryResult<ReviewRule.Settings>
    addRequests: number
  }
}
