import { Alert, Box, Button, Stack } from '@mui/material'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { authClient } from '../auth.ts'
import { ErrorState, RelativeTime, useDocumentTitle } from '../components.tsx'
import { ListSkeleton, useAnnounce } from '../primitives/feedback.tsx'
import { PageHeader } from '../primitives/PageHeader.tsx'
import { PageLayout } from '../primitives/PageLayout.tsx'
import { Row, Section } from '../primitives/Rows.tsx'

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
      announce('Signed out everywhere else')
      return queryClient.invalidateQueries({ queryKey: key })
    },
  })

  const currentToken = current?.session.token
  const others = data?.filter((s) => s.token !== currentToken) ?? []

  return (
    <PageLayout
      header={
        <PageHeader
          title="Your account"
          description={current ? `${current.user.name} · ${current.user.email}` : undefined}
        />
      }
    >
      {error ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : !data ? (
        <ListSkeleton rows={3} />
      ) : (
        <Stack spacing={2}>
          {revoke.error || revokeOthers.error ? (
            <Alert severity="error">{(revoke.error ?? revokeOthers.error)?.message}</Alert>
          ) : null}
          <Section title="Where you’re signed in" count={data.length}>
            {data.map((s) => {
              const isCurrent = s.token === currentToken
              return (
                <Row
                  key={s.id}
                  primary={
                    <>
                      {describeAgent(s.userAgent)}
                      {isCurrent ? ' (this device)' : ''}
                    </>
                  }
                  secondary={
                    <>
                      {s.ipAddress ? `${s.ipAddress} · ` : ''}signed in{' '}
                      <RelativeTime iso={new Date(s.createdAt).toISOString()} />
                    </>
                  }
                  action={
                    isCurrent ? null : (
                      <Button
                        size="small"
                        color="error"
                        disabled={revoke.isPending}
                        onClick={() => revoke.mutate(s.token)}
                      >
                        Sign out
                      </Button>
                    )
                  }
                />
              )
            })}
          </Section>
          {others.length > 0 ? (
            <Box>
              <Button
                color="error"
                variant="outlined"
                disabled={revokeOthers.isPending}
                onClick={() => revokeOthers.mutate()}
              >
                Sign out everywhere else
              </Button>
            </Box>
          ) : null}
        </Stack>
      )}
    </PageLayout>
  )
}
