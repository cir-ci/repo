import type { Team } from '@circi/api'
import { Banner, Delayed, ListSkeleton } from '@circi/ui'
import { useQuery } from '@tanstack/react-query'
import { useParams } from '@tanstack/react-router'

import { workspaceQuery } from '#features/members/api.ts'
import { TeamSettingsFrame } from '#features/teams/TeamSettingsFrame.tsx'
import { ErrorState } from '#lib/ErrorState.tsx'

import { rulesQuery } from './api.ts'
import { ReviewTargetSection } from './ReviewTargetSection.tsx'
import { RotationSection } from './RotationSection.tsx'
import { RulesSection } from './RulesSection.tsx'

/** Team › Settings › Reviews and triage: the review target, who reviews what, and the rotation. */
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
    return (
      <Delayed>
        <ListSkeleton />
      </Delayed>
    )
  }
  const data = rules.data
  return (
    <>
      {data.canManage ? null : <Banner>Only owners and admins can change these settings.</Banner>}
      <ReviewTargetSection
        // A fresh form whenever the saved value changes, so it never shows stale input.
        key={`target-${settings.settings.reviewTargetHours}`}
        workspace={workspace}
        team={team}
        settings={settings.settings}
        canManage={data.canManage}
      />
      <RulesSection
        workspace={workspace}
        team={team}
        rules={data.rules}
        people={people}
        canManage={data.canManage}
      />
      <RotationSection
        key={`rotation-${JSON.stringify(data.rotation)}`}
        workspace={workspace}
        team={team}
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
