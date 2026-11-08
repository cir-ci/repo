import { Banner, Button, ConfirmDialog, Text, useAnnounce } from '@circi/ui'
import { useQuery } from '@tanstack/react-query'
import { useParams } from '@tanstack/react-router'
import { useState } from 'react'

import { ErrorState } from '#lib/ErrorState.tsx'
import { RelativeTime } from '#lib/RelativeTime.tsx'

import { tokenQuery, useRotateToken } from './api.ts'
import { SecretBox } from './SecretBox.tsx'
import { TeamSettingsFrame } from './TeamSettingsFrame.tsx'

import styles from './CiTokenPage.module.css'
import shared from './TeamSettings.module.css'

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

      <section className={shared.section} aria-labelledby="ct-cur">
        <h2 id="ct-cur">Current token</h2>
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
        <div className={shared.box}>
          <dl className={styles.facts}>
            <div className={shared.row}>
              <dt className={styles.key}>Token</dt>
              <dd className={styles.value}>
                <Text variant="mono">{token ? (token.hint ?? 'No token') : '…'}</Text>
              </dd>
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
            <div className={shared.row}>
              <dt className={styles.key}>Created</dt>
              <dd className={styles.value}>
                {token?.createdAt ? (
                  <>
                    <RelativeTime iso={token.createdAt} />
                    {token.createdBy ? ` by ${token.createdBy.name}` : null}
                  </>
                ) : (
                  <Text tone="tertiary">{token ? 'Unknown' : '…'}</Text>
                )}
              </dd>
            </div>
            <div className={shared.row}>
              <dt className={styles.key}>Last used</dt>
              <dd className={styles.value}>
                {token?.lastUsedAt ? (
                  <RelativeTime iso={token.lastUsedAt} />
                ) : (
                  <Text tone="tertiary">{token ? 'Not used yet' : '…'}</Text>
                )}
              </dd>
            </div>
          </dl>
        </div>
        <Text variant="small" tone="tertiary">
          Rotating makes a new token and deletes this one: the old token stops working at once, so
          CI fails until you update its secret.
        </Text>
      </section>

      <section className={shared.section} aria-labelledby="ct-use">
        <div>
          <h2 id="ct-use">Use it in CI</h2>
          <Text as="p" variant="small" tone="secondary" className={shared.lead}>
            Set two secrets in your CI and run the upload after your screenshot tests.
          </Text>
        </div>
        <pre className={styles.code} tabIndex={0} aria-label="CI configuration">
          {`CIRCI_TOKEN=circi_…\nCIRCI_API_URL=${apiUrl}\n\nnpx circi upload ./screenshots --wait`}
        </pre>
        <div className={shared.box}>
          <dl className={styles.exit}>
            {EXIT_CODES.map(([code, meaning]) => (
              <div key={code} className={styles.exitRow}>
                <dt>
                  <Text variant="mono">{code}</Text>
                </dt>
                <dd>{meaning}</dd>
              </div>
            ))}
          </dl>
        </div>
        {repoRef ? (
          <Text as="p" variant="small" tone="tertiary">
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
      </section>

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
