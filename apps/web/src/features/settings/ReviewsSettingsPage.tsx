import { useQuery } from '@tanstack/react-query'
import { useParams } from '@tanstack/react-router'

import { organizationQuery } from '#features/members/api.ts'
import { settingsQuery } from '#features/projects/api.ts'
import { useDocumentTitle } from '#lib/document-title.ts'

import { rulesQuery } from './api.ts'
import { Frame } from './Frame.tsx'
import { ReviewTargetSection } from './ReviewTargetSection.tsx'
import { RotationSection } from './RotationSection.tsx'
import { RulesSection } from './RulesSection.tsx'

/** Project › Reviews and triage: the review target, who reviews what, and the triage rotation. */
export function ReviewsSettingsPage() {
  const { org, project } = useParams({ from: '/$org/$project/settings/reviews' })
  useDocumentTitle('Reviews and triage', project)
  const rules = useQuery(rulesQuery(org, project))
  const settings = useQuery(settingsQuery(org, project))
  const organization = useQuery(organizationQuery(org))
  const error = rules.error ?? settings.error
  const data = rules.data && settings.data ? { rules: rules.data, settings: settings.data } : null
  const people = (organization.data?.members ?? []).map((m) => ({
    id: m.userId,
    name: m.user.name,
  }))

  return (
    <Frame
      crumbs={[settings.data?.settings.name ?? project, 'Reviews and triage']}
      loading={!data && !error}
      error={error}
      onRetry={() => {
        void rules.refetch()
        void settings.refetch()
      }}
      notFound="This project doesn’t exist"
      readOnlyNote={
        !!data && !data.rules.canManage && 'Only owners and admins can change these settings.'
      }
    >
      {data ? (
        <>
          <ReviewTargetSection
            // A fresh form whenever the saved value changes, so it never shows stale input.
            key={`target-${data.settings.settings.reviewTargetHours}`}
            org={org}
            project={project}
            settings={data.settings.settings}
            canManage={data.rules.canManage}
          />
          <RulesSection
            org={org}
            project={project}
            rules={data.rules.rules}
            people={people}
            canManage={data.rules.canManage}
          />
          <RotationSection
            key={`rotation-${JSON.stringify(data.rules.rotation)}`}
            org={org}
            project={project}
            rotation={data.rules.rotation}
            people={people}
            canManage={data.rules.canManage}
          />
        </>
      ) : null}
    </Frame>
  )
}
