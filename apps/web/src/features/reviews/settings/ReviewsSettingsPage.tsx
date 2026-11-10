import type { ReviewRule, Team } from '@circi/api'
import { Button, PlusIcon } from '@circi/ui'
import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { useParams } from '@tanstack/react-router'
import { useState } from 'react'

import { TeamSettingsFrame } from '#features/team-settings/TeamSettingsFrame.tsx'
import { teamMembersQuery } from '#features/teams/api/members.ts'
import { ErrorState } from '#lib/ErrorState.tsx'
import { QuerySkeleton } from '#lib/QueryBoundary.tsx'

import { rulesQuery } from './api.ts'
import { ReviewsForm } from './ReviewsForm.tsx'
import { RulesSection } from './RulesSection.tsx'

/** Team › Settings › Reviews and triage: who reviews what, how fast, and the triage rotation. */
export function ReviewsSettingsPage() {
  const { workspace, team } = useParams({ from: '/$workspace/$team/settings/reviews' })
  const rules = useQuery(rulesQuery(workspace, team))
  // The header's "Add rule" asks the rules list to open its dialog. The page has its own Save bar, so
  // this button is not a second primary.
  const [addRequests, setAddRequests] = useState(0)
  return (
    <TeamSettingsFrame
      workspace={workspace}
      team={team}
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
          team={team}
          settings={settings}
          rules={rules}
          addRequests={addRequests}
        />
      )}
    </TeamSettingsFrame>
  )
}

function Reviews({ workspace, team, settings, rules, addRequests }: Reviews.Props) {
  // Rules, targets and the triage rotation draw their people from the team's members.
  const teamMembers = useQuery(teamMembersQuery(workspace, team))
  const people = (teamMembers.data?.members ?? []).map((m) => ({
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
        team={team}
        teamName={settings.settings.name}
        rules={data.rules}
        rotation={data.rotation}
        people={people}
        canManage={data.canManage}
        addRequests={addRequests}
      />
      <ReviewsForm
        workspace={workspace}
        team={team}
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
    team: string
    settings: Team.SettingsResponse
    rules: UseQueryResult<ReviewRule.Settings>
    addRequests: number
  }
}
