import { useQuery } from '@tanstack/react-query'
import { useParams } from '@tanstack/react-router'

import { workspaceAuthQuery } from '#features/members/api.ts'
import { useDocumentTitle } from '#lib/document-title.ts'

import { workspaceGeneralQuery } from './api.ts'
import { EmailDomains } from './EmailDomains.tsx'
import { Frame } from './Frame.tsx'
import { SignInMethods } from './SignInMethods.tsx'

/** How people get into the workspace: login methods (with its own SSO provider) and email domains. */
export function SignInPage() {
  const { workspace } = useParams({ from: '/workspaces/$workspace/settings/sign-in' })
  useDocumentTitle('Sign-in and domains', workspace)
  const general = useQuery(workspaceGeneralQuery(workspace))
  const auth = useQuery(workspaceAuthQuery(workspace))
  const error = general.error ?? auth.error
  const canManage = auth.data?.canManage === true

  return (
    <Frame
      workspace={{ slug: workspace, name: general.data?.name ?? workspace }}
      page="Sign-in and domains"
      loading={!auth.data && !error}
      error={error}
      onRetry={() => void (general.error ? general.refetch() : auth.refetch())}
      notFound="This workspace doesn’t exist"
      readOnlyNote={
        auth.data && !canManage
          ? 'Only owners and admins can change sign-in settings. Domains and single sign-on are hidden from other members.'
          : false
      }
    >
      <SignInMethods workspace={workspace} />
      {canManage ? <EmailDomains workspace={workspace} /> : null}
    </Frame>
  )
}
