import {
  Badge,
  Banner,
  Button,
  ConfirmDialog,
  SettingsRow,
  SettingsSection,
  useAnnounce,
} from '@circi/ui'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { authClient } from '#lib/auth-client.ts'
import { QueryBoundary } from '#lib/QueryBoundary.tsx'
import { RelativeTime } from '#lib/RelativeTime.tsx'

import { sessionsKey, sessionsQuery } from './api.ts'
import { describeAgent } from './model.ts'

/** Every browser signed in as you, with a way to sign any of them out. */
export function SessionsSection({ currentToken }: SessionsSection.Props) {
  const queryClient = useQueryClient()
  const announce = useAnnounce()
  const [confirmingOthers, setConfirmingOthers] = useState(false)
  const query = useQuery(sessionsQuery())
  const { data } = query

  const revoke = useMutation({
    mutationFn: async (token: string) => {
      const { error: failure } = await authClient.revokeSession({ token })
      if (failure) throw new Error('Couldn’t sign that device out')
    },
    onSuccess: () => {
      announce('Signed out')
      return queryClient.invalidateQueries({ queryKey: sessionsKey })
    },
  })
  const revokeOthers = useMutation({
    mutationFn: async () => {
      const { error: failure } = await authClient.revokeOtherSessions()
      if (failure) throw new Error('Couldn’t sign the other devices out')
    },
    onSuccess: () => {
      setConfirmingOthers(false)
      announce('Signed out everywhere else')
      return queryClient.invalidateQueries({ queryKey: sessionsKey })
    },
    onError: () => setConfirmingOthers(false),
  })
  const others = data?.filter((s) => s.token !== currentToken) ?? []
  const failure = revoke.error ?? revokeOthers.error

  return (
    <>
      <SettingsSection
        title="Sessions"
        description="Every browser signed in as you. Signing one out also cuts off its access to hosted sites within a minute."
        actions={
          others.length > 0 ? (
            <Button variant="danger" onClick={() => setConfirmingOthers(true)}>
              Sign out everywhere else
            </Button>
          ) : undefined
        }
      >
        <QueryBoundary query={query} rows={3}>
          {(loaded) =>
            loaded.map((s) => {
              const isCurrent = s.token === currentToken
              return (
                <SettingsRow
                  key={s.id}
                  label={describeAgent(s.userAgent)}
                  detail={
                    <>
                      {s.ipAddress ? `${s.ipAddress} · ` : ''}signed in{' '}
                      <RelativeTime iso={new Date(s.createdAt).toISOString()} />
                    </>
                  }
                >
                  {isCurrent ? (
                    <Badge tone="accent" shape="tag">
                      This device
                    </Badge>
                  ) : (
                    <Button
                      variant="ghost"
                      disabled={revoke.isPending}
                      onClick={() => revoke.mutate(s.token)}
                    >
                      Sign out
                    </Button>
                  )}
                </SettingsRow>
              )
            })
          }
        </QueryBoundary>
      </SettingsSection>
      {failure ? <Banner tone="danger">{failure.message}</Banner> : null}
      <ConfirmDialog
        open={confirmingOthers}
        onOpenChange={setConfirmingOthers}
        title="Sign out everywhere else?"
        description="Every other device signed in as you is signed out. This device stays signed in."
        confirmLabel="Sign out"
        loading={revokeOthers.isPending}
        onConfirm={() => revokeOthers.mutate()}
      />
    </>
  )
}

export namespace SessionsSection {
  export interface Props {
    currentToken: string | undefined
  }
}
