import { Banner, Button, ConfirmDialog, ListRow, SectionHeader, Text, useAnnounce } from '@circi/ui'
import { useState } from 'react'

import { useRotateToken } from './api.ts'
import { SecretBox } from './CreateDialogs.tsx'

import tokenStyles from './CiTokenSection.module.css'
import styles from './SettingsSection.module.css'

/** What a stored token looks like: it is only ever shown when it's created. */
const MASKED = '••••••••••••••••••••'

export function CiToken({ workspace, team }: CiToken.Props) {
  const rotate = useRotateToken(workspace, team)
  const announce = useAnnounce()
  const [confirming, setConfirming] = useState(false)
  return (
    <section className={styles.section}>
      <SectionHeader
        divided
        title="CI token"
        description="CI jobs upload with this team’s token. A token is only shown when it’s created, so if it’s lost, replace it: the old one stops working immediately."
      />
      {rotate.data ? (
        <Banner tone="warning">
          New token. Copy it now and update{' '}
          <Text as="code" variant="mono">
            CIRCI_TOKEN
          </Text>{' '}
          in your CI secrets: it isn’t shown again.
          <div className={tokenStyles['secret']}>
            <SecretBox label="CI token" value={rotate.data.token} />
          </div>
        </Banner>
      ) : null}
      {rotate.error && !confirming ? <Banner tone="danger">{rotate.error.message}</Banner> : null}
      <div className={tokenStyles['list']}>
        <ListRow
          trailing={
            <Button
              variant="danger"
              size="sm"
              onClick={() => {
                rotate.reset()
                setConfirming(true)
              }}
            >
              Replace token…
            </Button>
          }
        >
          <Text variant="mono" tone="secondary" aria-label="Token hidden">
            {MASKED}
          </Text>
        </ListRow>
      </div>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Replace the CI token?"
        description="The current token stops working immediately. You will get a new one to put in your CI secrets."
        confirmLabel="Replace token"
        loading={rotate.isPending}
        onConfirm={() =>
          rotate.mutate(undefined, {
            onSuccess: () => announce('CI token replaced'),
            onSettled: () => setConfirming(false),
          })
        }
      />
    </section>
  )
}

export namespace CiToken {
  export interface Props {
    workspace: string
    team: string
  }
}
