import { Alert, Stack } from '@mui/material'
import { useQuery } from '@tanstack/react-query'
import { useParams } from '@tanstack/react-router'

import { ErrorState, useDocumentTitle } from '../../components.tsx'
import { ListSkeleton } from '../../primitives/feedback.tsx'
import { PageHeader } from '../../primitives/PageHeader.tsx'
import { PageLayout } from '../../primitives/PageLayout.tsx'
import { settingsQuery } from './api.ts'
import { CiToken } from './CiTokenSection.tsx'
import { GithubLink } from './GithubSection.tsx'
import { SettingsForm } from './SettingsForm.tsx'
import { Webhooks } from './WebhooksSection.tsx'

/** A project's settings, and where it sends webhooks. Owners and admins edit; members look. */
export function ProjectSettingsPage() {
  const { org, project } = useParams({ from: '/$org/$project/settings' })
  const { data, error, refetch } = useQuery(settingsQuery(org, project))
  useDocumentTitle('Settings', project)

  return (
    <PageLayout header={<PageHeader title={`${data?.settings.name ?? project} settings`} />}>
      {error ? (
        <ErrorState
          error={error}
          onRetry={() => void refetch()}
          notFound="This project doesn’t exist"
        />
      ) : !data ? (
        <ListSkeleton />
      ) : (
        <Stack spacing={4}>
          {data.canManage ? null : (
            <Alert severity="info">Only owners and admins can change these settings.</Alert>
          )}
          <SettingsForm
            // A fresh form whenever the saved values change, so it never shows stale input.
            key={JSON.stringify(data.settings)}
            org={org}
            project={project}
            settings={data.settings}
            canManage={data.canManage}
          />
          {data.canManage ? <CiToken org={org} project={project} /> : null}
          {data.github.configured ? (
            <GithubLink
              org={org}
              project={project}
              github={data.github}
              canManage={data.canManage}
            />
          ) : null}
          <Webhooks
            org={org}
            project={project}
            hooks={data.webhooks}
            events={data.webhookEvents}
            canManage={data.canManage}
          />
        </Stack>
      )}
    </PageLayout>
  )
}
