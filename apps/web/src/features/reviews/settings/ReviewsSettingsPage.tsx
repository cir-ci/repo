import type { Team } from '@circi/api'
import { useQuery } from '@tanstack/react-query'
import { useParams } from '@tanstack/react-router'

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
  return (
    <TeamSettingsFrame workspace={workspace} team={team} page="Reviews and triage">
      {(settings) => <Reviews workspace={workspace} team={team} settings={settings} />}
    </TeamSettingsFrame>
  )
}

function Reviews({ workspace, team, settings }: Reviews.Props) {
  const rules = useQuery(rulesQuery(workspace, team))
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
      />
      <ReviewsForm
        workspace={workspace}
        team={team}
        settings={settings.settings}
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
  }
}
