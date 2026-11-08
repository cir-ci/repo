import { useQuery } from '@tanstack/react-query'
import { useParams } from '@tanstack/react-router'

import { workspaceQuery } from '#features/members/api.ts'
import { settingsQuery } from '#features/teams/api.ts'
import { useDocumentTitle } from '#lib/document-title.ts'

import { rulesQuery } from './api.ts'
import { Frame } from './Frame.tsx'
import { ReviewTargetSection } from './ReviewTargetSection.tsx'
import { RotationSection } from './RotationSection.tsx'
import { RulesSection } from './RulesSection.tsx'

/** Team › Reviews and triage: the review target, who reviews what, and the triage rotation. */
export function ReviewsSettingsPage() {
  const { workspace, team } = useParams({ from: '/$workspace/$team/settings/reviews' })
  useDocumentTitle('Reviews and triage', team)
  const rules = useQuery(rulesQuery(workspace, team))
  const settings = useQuery(settingsQuery(workspace, team))
  const workspaceInfo = useQuery(workspaceQuery(workspace))
  const error = rules.error ?? settings.error
  const data = rules.data && settings.data ? { rules: rules.data, settings: settings.data } : null
  const people = (workspaceInfo.data?.members ?? []).map((m) => ({
    id: m.userId,
    name: m.user.name,
  }))

  return (
    <Frame
      crumbs={[settings.data?.settings.name ?? team, 'Reviews and triage']}
      loading={!data && !error}
      error={error}
      onRetry={() => {
        void rules.refetch()
        void settings.refetch()
      }}
      notFound="This team doesn’t exist"
      readOnlyNote={
        !!data && !data.rules.canManage && 'Only owners and admins can change these settings.'
      }
    >
      {data ? (
        <>
          <ReviewTargetSection
            // A fresh form whenever the saved value changes, so it never shows stale input.
            key={`target-${data.settings.settings.reviewTargetHours}`}
            workspace={workspace}
            team={team}
            settings={data.settings.settings}
            canManage={data.rules.canManage}
          />
          <RulesSection
            workspace={workspace}
            team={team}
            rules={data.rules.rules}
            people={people}
            canManage={data.rules.canManage}
          />
          <RotationSection
            key={`rotation-${JSON.stringify(data.rules.rotation)}`}
            workspace={workspace}
            team={team}
            rotation={data.rules.rotation}
            people={people}
            canManage={data.rules.canManage}
          />
        </>
      ) : null}
    </Frame>
  )
}
