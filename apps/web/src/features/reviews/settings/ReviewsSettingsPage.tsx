import type { Team } from '@circi/api'
import { Banner, Text } from '@circi/ui'
import { useQuery } from '@tanstack/react-query'
import { useParams } from '@tanstack/react-router'

import { workspaceQuery } from '#features/members/api.ts'
import { TeamSettingsFrame } from '#features/team-settings/TeamSettingsFrame.tsx'
import { ErrorState } from '#lib/ErrorState.tsx'
import { QuerySkeleton } from '#lib/QueryBoundary.tsx'

import { rulesQuery } from './api.ts'
import { ReviewsForm } from './ReviewsForm.tsx'
import { RulesSection } from './RulesSection.tsx'

/** Team › Settings › Reviews and triage: who reviews what, how fast, and the triage rotation. */
export function ReviewsSettingsPage() {
  const { workspace, team } = useParams({ from: '/$workspace/$team/settings/reviews' })
  return (
    <TeamSettingsFrame
      workspace={workspace}
      team={team}
      page="Reviews and triage"
      readOnlyNote={false}
    >
      {(settings) => <Reviews workspace={workspace} team={team} settings={settings} />}
    </TeamSettingsFrame>
  )
}

function Reviews({ workspace, team, settings }: Reviews.Props) {
  const rules = useQuery(rulesQuery(workspace, team))
  const workspaceInfo = useQuery(workspaceQuery(workspace))
  const people = (workspaceInfo.data?.members ?? []).map((m) => ({
    id: m.userId,
    name: m.user.name,
  }))
  if (rules.error) return <ErrorState error={rules.error} onRetry={() => void rules.refetch()} />
  if (!rules.data) {
    return <QuerySkeleton />
  }
  const data = rules.data
  return (
    <>
      <Text as="p" tone="secondary">
        Who reviews a build, how fast, and what CirCI does on its own.
      </Text>
      {data.canManage ? null : <Banner>Only owners and admins can change these settings.</Banner>}
      <RulesSection
        workspace={workspace}
        team={team}
        rules={data.rules}
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
