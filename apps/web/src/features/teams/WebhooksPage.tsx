import {
  Banner,
  Button,
  Checkbox,
  CheckboxGroup,
  ConfirmDialog,
  Dialog,
  ListRow,
  Text,
  TextField,
  useAnnounce,
} from '@circi/ui'
import { useParams } from '@tanstack/react-router'
import { type FormEvent, useState } from 'react'

import { RelativeTime } from '#lib/RelativeTime.tsx'

import { useAddWebhook, useDeleteWebhook } from './api.ts'
import { SecretBox } from './SecretBox.tsx'
import { TeamSettingsFrame } from './TeamSettingsFrame.tsx'
import { eventDescription, webhookProblems } from './webhook-events.ts'

import shared from './TeamSettings.module.css'
import styles from './WebhooksPage.module.css'

/** A team's webhooks: signed build events sent to its own services. */
export function WebhooksPage() {
  const { workspace, team } = useParams({ from: '/$workspace/$team/settings/webhooks' })
  return (
    <TeamSettingsFrame workspace={workspace} team={team} page="Webhooks">
      {(data, name) => (
        <Webhooks
          workspace={workspace}
          team={team}
          name={name}
          hooks={data.webhooks}
          events={data.webhookEvents}
          canManage={data.canManage}
        />
      )}
    </TeamSettingsFrame>
  )
}

function Webhooks(props: Webhooks.Props) {
  const add = useAddWebhook(props.workspace, props.team)
  const remove = useDeleteWebhook(props.workspace, props.team)
  const announce = useAnnounce()
  const [adding, setAdding] = useState(false)
  const [secret, setSecret] = useState<{ url: string; value: string } | null>(null)
  const [picked, setPicked] = useState<string[]>(props.events)
  const [urlError, setUrlError] = useState<string | null>(null)
  const [eventsError, setEventsError] = useState<string | null>(null)
  const [removing, setRemoving] = useState<Webhooks.Hook | null>(null)

  function open() {
    add.reset()
    setSecret(null)
    setPicked(props.events)
    setUrlError(null)
    setEventsError(null)
    setAdding(true)
  }

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const raw = new FormData(e.currentTarget).get('url')
    const url = typeof raw === 'string' ? raw.trim() : ''
    const problems = webhookProblems(url, picked)
    // Both problems are shown together, and nothing is sent until both are fixed.
    setUrlError(problems.url)
    setEventsError(problems.events)
    if (problems.url || problems.events) return
    add.mutate(
      { url, events: picked },
      {
        onSuccess: (created) => {
          setSecret({ url: created.webhook.url, value: created.secret })
          announce('Webhook added')
        },
      },
    )
  }

  return (
    <>
      <div className={styles.head}>
        <div className={styles.headText}>
          <Text as="p" variant="small" tone="secondary">
            Send {props.name}’s build events as signed JSON to your own services. Failed deliveries
            are retried with backoff.
          </Text>
        </div>
        {props.canManage ? (
          <Button variant="primary" onClick={open}>
            Add webhook
          </Button>
        ) : null}
      </div>

      <section className={shared.section} aria-label="Webhooks">
        <ul aria-label="Webhooks" className={styles.list}>
          {props.hooks.length === 0 ? (
            <li>
              <ListRow>
                <Text tone="secondary">No webhooks yet</Text>
              </ListRow>
            </li>
          ) : (
            props.hooks.map((h) => (
              <li key={h.id}>
                <ListRow
                  trailing={
                    props.canManage ? (
                      <Button variant="danger" size="sm" onClick={() => setRemoving(h)}>
                        Remove
                      </Button>
                    ) : undefined
                  }
                >
                  <Text variant="mono" truncate as="div">
                    {h.url}
                  </Text>
                  <div className={styles.meta}>
                    <ul aria-label="Events" className={styles.events}>
                      {h.events.map((event) => (
                        <li key={event} className={styles.chip}>
                          <Text variant="micro" tone="secondary">
                            {event}
                          </Text>
                        </li>
                      ))}
                    </ul>
                    <Text variant="small" tone="secondary">
                      added <RelativeTime iso={h.createdAt} />
                    </Text>
                  </div>
                </ListRow>
              </li>
            ))
          )}
        </ul>
        {remove.error && !removing ? <Banner tone="danger">{remove.error.message}</Banner> : null}
      </section>

      <section className={shared.section} aria-labelledby="wh-verify">
        <div>
          <h2 id="wh-verify">Checking a delivery</h2>
          <Text as="p" variant="small" tone="secondary" className={shared.lead}>
            Each request carries{' '}
            <Text as="code" variant="mono">
              CirCI-Event
            </Text>
            ,{' '}
            <Text as="code" variant="mono">
              CirCI-Delivery
            </Text>{' '}
            and{' '}
            <Text as="code" variant="mono">
              CirCI-Signature: t=…,v1=…
            </Text>
            , where v1 is the HMAC-SHA256 of{' '}
            <Text as="code" variant="mono">
              {'<t>.<body>'}
            </Text>{' '}
            with the webhook’s secret. Reject signatures older than a few minutes. Any answer other
            than 2xx is retried; redirects are not followed.
          </Text>
        </div>
      </section>

      <Dialog
        open={adding}
        onOpenChange={setAdding}
        title={secret ? 'Signing secret' : 'Add webhook'}
        size="wide"
        actions={
          secret ? (
            <Button variant="primary" onClick={() => setAdding(false)}>
              Done
            </Button>
          ) : (
            <>
              <Button variant="ghost" onClick={() => setAdding(false)}>
                Cancel
              </Button>
              <Button type="submit" form="add-webhook" variant="primary" loading={add.isPending}>
                {add.isPending ? 'Adding…' : 'Add webhook'}
              </Button>
            </>
          )
        }
      >
        {secret ? (
          <div className={styles.dialogForm}>
            <Text>Webhook added. Use this secret to check each delivery’s signature.</Text>
            <SecretBox label={`Signing secret for ${secret.url}`} value={secret.value} />
            <Text variant="small" tone="tertiary">
              Copy it now: it isn’t shown again.
            </Text>
          </div>
        ) : (
          <form id="add-webhook" onSubmit={submit} noValidate className={styles.dialogForm}>
            <TextField
              name="url"
              type="url"
              label="Address"
              placeholder="https://hooks.example.com/circi"
              required
              description="Must be public: localhost, private networks and cloud metadata addresses are refused."
              error={urlError}
            />
            <div className={styles.eventsField}>
              <CheckboxGroup
                legend="Events"
                value={picked}
                onValueChange={(next) => {
                  setPicked(next)
                  if (next.length > 0) setEventsError(null)
                }}
              >
                <div className={styles.checks}>
                  {props.events.map((event) => (
                    <Checkbox
                      key={event}
                      value={event}
                      label={event}
                      description={eventDescription(event)}
                    />
                  ))}
                </div>
              </CheckboxGroup>
              {eventsError ? (
                <Text variant="small" tone="rejected" role="alert">
                  {eventsError}
                </Text>
              ) : null}
            </div>
            {add.error ? <Banner tone="danger">{add.error.message}</Banner> : null}
          </form>
        )}
      </Dialog>

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(isOpen) => {
          if (!isOpen) setRemoving(null)
        }}
        title="Remove webhook?"
        description={
          removing ? (
            <>
              <Text as="code" variant="mono" className={styles.wrap}>
                {removing.url}
              </Text>{' '}
              stops receiving build events right away. This can’t be undone.
            </>
          ) : undefined
        }
        confirmLabel="Remove"
        loading={remove.isPending}
        onConfirm={() => {
          if (!removing) return
          remove.mutate(removing.id, {
            onSuccess: () => announce('Webhook removed'),
            onSettled: () => setRemoving(null),
          })
        }}
      />
    </>
  )
}

namespace Webhooks {
  export interface Hook {
    id: string
    url: string
    events: string[]
    createdAt: string
  }
  export interface Props {
    workspace: string
    team: string
    name: string
    hooks: Hook[]
    events: string[]
    canManage: boolean
  }
}
