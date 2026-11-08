import {
  Banner,
  Breadcrumbs,
  Button,
  ConfirmDialog,
  Delayed,
  Heading,
  ListRow,
  ListSkeleton,
  PanelHeader,
  SectionHeader,
  Stack,
  Text,
  useAnnounce,
} from '@circi/ui'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { authClient } from '../../lib/auth-client.ts'
import { useDocumentTitle } from '../../lib/document-title.ts'
import { ErrorState } from '../../lib/ErrorState.tsx'
import { RelativeTime } from '../../lib/RelativeTime.tsx'
import { authMethodsQuery } from '../auth/api.ts'

import styles from './AccountPage.module.css'

/** A short, readable name for a browser's user-agent string, e.g. "Firefox on macOS". */
export function describeAgent(agent: string | null | undefined): string {
  if (!agent) return 'Unknown device'
  const browser = /Edg\//.test(agent)
    ? 'Edge'
    : /OPR\/|Opera/.test(agent)
      ? 'Opera'
      : /Firefox\//.test(agent)
        ? 'Firefox'
        : /Chrome\//.test(agent)
          ? 'Chrome'
          : /Safari\//.test(agent)
            ? 'Safari'
            : /curl\//.test(agent)
              ? 'curl'
              : 'Browser'
  const os = /Windows/.test(agent)
    ? 'Windows'
    : /iPhone|iPad/.test(agent)
      ? 'iOS'
      : /Android/.test(agent)
        ? 'Android'
        : /Mac OS X/.test(agent)
          ? 'macOS'
          : /Linux/.test(agent)
            ? 'Linux'
            : ''
  return os ? `${browser} on ${os}` : browser
}

/** Your account: the devices signed in as you, with a way to sign any of them out. */
export function AccountPage() {
  const { data: current } = authClient.useSession()
  const queryClient = useQueryClient()
  const announce = useAnnounce()
  const [confirmingOthers, setConfirmingOthers] = useState(false)
  useDocumentTitle('Account')

  const key = ['sessions'] as const
  const { data, error, refetch } = useQuery({
    queryKey: key,
    queryFn: async () => {
      const { data: list, error: failure } = await authClient.listSessions()
      if (failure || !list) throw new Error('Couldn’t load your sessions')
      return list.toSorted((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))
    },
  })

  const revoke = useMutation({
    mutationFn: async (token: string) => {
      const { error: failure } = await authClient.revokeSession({ token })
      if (failure) throw new Error('Couldn’t sign that device out')
    },
    onSuccess: () => {
      announce('Signed out')
      return queryClient.invalidateQueries({ queryKey: key })
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
      return queryClient.invalidateQueries({ queryKey: key })
    },
    onError: () => setConfirmingOthers(false),
  })

  const methods = useQuery(authMethodsQuery())
  const githubOn = methods.data?.sso.some((p) => p.id === 'github') === true
  const currentToken = current?.session.token
  const others = data?.filter((s) => s.token !== currentToken) ?? []
  const failure = revoke.error ?? revokeOthers.error

  return (
    <>
      <PanelHeader>
        <Breadcrumbs items={[{ label: 'Account' }]} />
      </PanelHeader>
      <div className={styles['content']}>
        <Stack gap={1}>
          <Heading level="title" as="h1">
            Your account
          </Heading>
          {current ? (
            <Text tone="secondary">
              {current.user.name} · {current.user.email}
            </Text>
          ) : null}
        </Stack>
        {error ? (
          <ErrorState error={error} onRetry={() => void refetch()} />
        ) : !data ? (
          <Delayed>
            <ListSkeleton rows={3} />
          </Delayed>
        ) : (
          <>
            {failure ? <Banner tone="danger">{failure.message}</Banner> : null}
            <section className={styles['section']}>
              <SectionHeader
                title={
                  <>
                    Where you’re signed in{' '}
                    <Text variant="micro" tone="tertiary">
                      {data.length}
                    </Text>
                  </>
                }
              />
              <div className={styles['list']}>
                {data.map((s) => {
                  const isCurrent = s.token === currentToken
                  return (
                    <ListRow
                      key={s.id}
                      trailing={
                        isCurrent ? undefined : (
                          <Button
                            size="sm"
                            variant="danger"
                            disabled={revoke.isPending}
                            onClick={() => revoke.mutate(s.token)}
                          >
                            Sign out
                          </Button>
                        )
                      }
                    >
                      <Text as="div" truncate>
                        {describeAgent(s.userAgent)}
                        {isCurrent ? ' (this device)' : ''}
                      </Text>
                      <Text as="div" variant="small" tone="secondary">
                        {s.ipAddress ? `${s.ipAddress} · ` : ''}signed in{' '}
                        <RelativeTime iso={new Date(s.createdAt).toISOString()} />
                      </Text>
                    </ListRow>
                  )
                })}
              </div>
            </section>
            {githubOn ? (
              <section className={styles['section']}>
                <SectionHeader
                  title="GitHub"
                  description="Link your GitHub login so that Approve and Reject on pull requests count as you."
                />
                <div>
                  <Button
                    onClick={() =>
                      void authClient.linkSocial({ provider: 'github', callbackURL: '/account' })
                    }
                  >
                    Link GitHub
                  </Button>
                </div>
              </section>
            ) : null}
            {others.length > 0 ? (
              <div>
                <Button variant="danger" onClick={() => setConfirmingOthers(true)}>
                  Sign out everywhere else
                </Button>
              </div>
            ) : null}
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
        )}
      </div>
    </>
  )
}
