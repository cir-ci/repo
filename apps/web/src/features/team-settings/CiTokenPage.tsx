import {
  Banner,
  Button,
  ConfirmDialog,
  SecretBox,
  SettingsSection,
  Text,
  useAnnounce,
} from '@circi/ui'
import { useQuery } from '@tanstack/react-query'
import { useParams } from '@tanstack/react-router'
import { Fragment, useState } from 'react'

import { tokenQuery, useRotateToken } from '#features/teams/api/index.ts'
import { ErrorState } from '#lib/ErrorState.tsx'
import { RelativeTime } from '#lib/RelativeTime.tsx'

import { TeamSettingsFrame } from './TeamSettingsFrame.tsx'

import styles from './CiTokenPage.module.css'

/** The exit codes `circi upload --wait` ends with. */
const EXIT_CODES = [
  ['0', 'Passed: no changes, or changes already approved.'],
  ['1', 'Visual changes need review. The job fails until someone approves, then re-run it.'],
  ['2', 'Upload or processing error.'],
] as const

/** A team's CI token: what is known about it, how to replace it, and how CI uses it. */
export function CiTokenPage() {
  const { workspace, team } = useParams({ from: '/$workspace/$team/settings/token' })
  return (
    <TeamSettingsFrame workspace={workspace} team={team} page="CI token" readOnlyNote={false}>
      {(data, name) => (
        <TokenBody
          workspace={workspace}
          team={team}
          name={name}
          repoRef={data.github.link?.repoRef ?? null}
        />
      )}
    </TeamSettingsFrame>
  )
}

function TokenBody({ workspace, team, name, repoRef }: TokenBody.Props) {
  const { data: token, error, refetch } = useQuery(tokenQuery(workspace, team))
  const rotate = useRotateToken(workspace, team)
  const announce = useAnnounce()
  const [confirming, setConfirming] = useState(false)
  const apiUrl = window.location.origin

  if (error) {
    return <ErrorState error={error} onRetry={() => void refetch()} />
  }
  return (
    <>
      <Text as="p" tone="secondary" className={styles.lead}>
        CI uses this token to upload {name}’s screenshots. It can create builds and read their
        status for {name} only; it can’t open the dashboard or any other team.
      </Text>

      {token && !token.canManage ? (
        <Banner>Only owners and admins can replace the token.</Banner>
      ) : null}
      {rotate.data ? (
        <Banner tone="success" title={`New token for ${name}`}>
          <div className={styles.secret}>
            <SecretBox label="CI token" value={rotate.data.token} />
          </div>
          Copy it into your CI secrets now. It won’t be shown again; if you lose it, rotate again.
        </Banner>
      ) : null}
      {rotate.error && !confirming ? <Banner tone="danger">{rotate.error.message}</Banner> : null}

      <SettingsSection title="Current token" bare>
        <div className={styles.box}>
          <div className={styles.kv}>
            <span className={styles.key}>Token</span>
            <Text variant="mono" className={styles.val}>
              {token ? (token.hint ?? 'No token') : '…'}
            </Text>
            {token?.canManage ? (
              <Button
                size="sm"
                onClick={() => {
                  rotate.reset()
                  setConfirming(true)
                }}
              >
                Rotate token
              </Button>
            ) : null}
          </div>
          <div className={styles.kv}>
            <span className={styles.key}>Created</span>
            <span className={styles.val}>
              {token?.createdAt ? (
                <>
                  <RelativeTime iso={token.createdAt} />
                  {token.createdBy ? ` by ${token.createdBy.name}` : null}
                </>
              ) : (
                <Text tone="tertiary">{token ? 'Unknown' : '…'}</Text>
              )}
            </span>
          </div>
          <div className={styles.kv}>
            <span className={styles.key}>Last used</span>
            <span className={styles.val}>
              {token?.lastUsedAt ? (
                <RelativeTime iso={token.lastUsedAt} />
              ) : (
                <Text tone="tertiary">{token ? 'Not used yet' : '…'}</Text>
              )}
            </span>
          </div>
        </div>
        <Text as="p" variant="small" tone="tertiary" className={styles.note}>
          Rotating makes a new token and deletes this one: the old token stops working at once, so
          CI fails until you update its secret.
        </Text>
      </SettingsSection>

      <SettingsSection
        title="Use it in CI"
        description="Set two secrets in your CI and run the upload after your screenshot tests."
        bare
      >
        <pre className={styles.code} tabIndex={0} aria-label="CI configuration">
          {`CIRCI_TOKEN=circi_…\nCIRCI_API_URL=${apiUrl}\n\nnpx circi upload ./screenshots --wait`}
        </pre>
        <div className={styles.box}>
          <dl className={styles.exit}>
            {EXIT_CODES.map(([code, meaning]) => (
              <Fragment key={code}>
                <Text as="dt" variant="mono">
                  {code}
                </Text>
                <dd className={styles.meaning}>{meaning}</dd>
              </Fragment>
            ))}
          </dl>
        </div>
        {repoRef ? (
          <Text as="p" variant="small" tone="tertiary" className={styles.note}>
            {name} is linked to{' '}
            <Text as="code" variant="mono">
              {repoRef}
            </Text>
            , so the CirCI check on the pull request is the gate instead:{' '}
            <Text as="code" variant="mono">
              --wait
            </Text>{' '}
            exits 0 on unreviewed changes and the check turns green when someone approves, with no
            re-run. Override with{' '}
            <Text as="code" variant="mono">
              --gate exit-code
            </Text>
            .
          </Text>
        ) : null}
      </SettingsSection>

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Rotate the CI token?"
        description="The current token stops working immediately. You will get a new one to put in your CI secrets."
        confirmLabel="Rotate token"
        loading={rotate.isPending}
        onConfirm={() =>
          rotate.mutate(undefined, {
            onSuccess: () => announce('CI token replaced'),
            onSettled: () => setConfirming(false),
          })
        }
      />
    </>
  )
}

namespace TokenBody {
  export interface Props {
    workspace: string
    team: string
    name: string
    repoRef: string | null
  }
}
