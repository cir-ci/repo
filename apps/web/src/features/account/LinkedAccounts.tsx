import {
  Badge,
  Banner,
  Button,
  ConfirmDialog,
  SettingsRow,
  SettingsSection,
  Text,
  useAnnounce,
} from '@circi/ui'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { authMethodsQuery } from '#features/auth/api.ts'
import { authClient } from '#lib/auth-client.ts'
import { ErrorState } from '#lib/ErrorState.tsx'

import { accountsKey, accountsQuery } from './api.ts'
import { providerRows } from './model.ts'

/** The accounts you can sign in with: unlink one, or link a provider this instance offers. */
export function LinkedAccounts() {
  const queryClient = useQueryClient()
  const announce = useAnnounce()
  const accounts = useQuery(accountsQuery())
  const methods = useQuery(authMethodsQuery())
  const [unlinking, setUnlinking] = useState<{
    providerId: string
    accountId: string
    name: string
  }>()

  const unlink = useMutation({
    mutationFn: async (input: { providerId: string; accountId: string }) => {
      const { error } = await authClient.unlinkAccount(input)
      if (error) throw new Error(error.message ?? 'Couldn’t unlink that account')
    },
    onSuccess: () => {
      announce('Account unlinked')
      return queryClient.invalidateQueries({ queryKey: accountsKey })
    },
    onSettled: () => setUnlinking(undefined),
  })
  const link = useMutation({
    mutationFn: async (provider: string) => {
      const { error } = await authClient.linkSocial({
        provider,
        callbackURL: '/account/profile',
      })
      if (error) throw new Error(error.message ?? 'Couldn’t start linking')
    },
  })

  const rows = accounts.data ? providerRows(accounts.data, methods.data?.sso ?? []) : []
  const failure = unlink.error ?? link.error

  return (
    <>
      <SettingsSection
        title="Signed in with"
        description="Accounts you can sign in with. Linking GitHub also lets you approve and reject from GitHub checks and pull request comments."
        bare={!(accounts.data && rows.length > 0)}
      >
        {accounts.error ? (
          <ErrorState error={accounts.error} onRetry={() => void accounts.refetch()} />
        ) : accounts.data && rows.length === 0 ? (
          <Text tone="secondary">
            You sign in with your password. No other sign-in accounts are available on this server.
          </Text>
        ) : accounts.data ? (
          rows.map((r) => (
            <SettingsRow key={r.id} label={r.name} detail={r.account ? 'Linked' : 'Not linked'}>
              {r.account ? (
                <>
                  <Badge tone="state" state="approved" shape="tag">
                    Linked
                  </Badge>
                  <Button
                    variant="ghost"
                    aria-label={`Unlink ${r.name}`}
                    onClick={() =>
                      setUnlinking({
                        providerId: r.account.providerId,
                        accountId: r.account.accountId,
                        name: r.name,
                      })
                    }
                  >
                    Unlink
                  </Button>
                </>
              ) : (
                <Button
                  aria-label={`Link ${r.name}`}
                  loading={link.isPending && link.variables === r.id}
                  disabled={link.isPending}
                  onClick={() => link.mutate(r.id)}
                >
                  Link {r.name}
                </Button>
              )}
            </SettingsRow>
          ))
        ) : null}
      </SettingsSection>
      {failure ? <Banner tone="danger">{failure.message}</Banner> : null}
      <ConfirmDialog
        open={unlinking !== undefined}
        onOpenChange={(open) => {
          if (!open) setUnlinking(undefined)
        }}
        title={`Unlink ${unlinking?.name ?? 'this account'}?`}
        description="You can no longer sign in with it until you link it again. You can’t unlink the only way you have to sign in."
        confirmLabel="Unlink"
        loading={unlink.isPending}
        onConfirm={() => {
          if (unlinking) {
            unlink.mutate({ providerId: unlinking.providerId, accountId: unlinking.accountId })
          }
        }}
      />
    </>
  )
}
