import type { Team } from '@circi/api'
import {
  Badge,
  Banner,
  Button,
  Checkbox,
  CheckboxGroup,
  ConfirmDialog,
  Dialog,
  EmptyState,
  ListRow,
  SecretBox,
  SettingsSection,
  Text,
  TextField,
  useAnnounce,
  WebhookIcon,
} from '@circi/ui'
import { useParams } from '@tanstack/react-router'
import { type FormEvent, useState } from 'react'

import { useAddWebhook, useDeleteWebhook } from '#features/teams/api/index.ts'
import { RelativeTime } from '#lib/RelativeTime.tsx'

import { TeamSettingsFrame } from './TeamSettingsFrame.tsx'
import { useWebhookTest } from './use-webhook-test.ts'
import {
  attemptLabel,
  deliveryAnswer,
  eventDescription,
  hookStatus,
  webhookProblems,
} from './webhook-events.ts'

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
  const test = useWebhookTest(props.workspace, props.team, props.hooks, {
    queued: () => announce('Test event queued'),
    delivered: (d) => announce(`Webhook test delivered: ${deliveryAnswer(d).text}`),
  })
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
      <SettingsSection
        title="Webhooks"
        description={`Send ${props.name}'s build events as signed JSON to your own services. Failed deliveries are retried 8 times with backoff.`}
        actions={
          props.canManage ? (
            <Button variant="primary" onClick={open}>
              Add webhook
            </Button>
          ) : undefined
        }
        bare
      >
        {props.hooks.length === 0 ? (
          <EmptyState icon={<WebhookIcon />} size="section" title="No webhooks yet">
            {props.canManage
              ? 'Send build and review events to another service.'
              : 'Ask an owner to add one.'}
          </EmptyState>
        ) : (
          <ul aria-label="Webhooks" className={styles.list}>
            {props.hooks.map((h) => (
              <li key={h.id}>
                <ListRow
                  trailing={
                    <div className={styles.rowActions}>
                      <HookBadge hook={h} />
                      {props.canManage ? (
                        <>
                          <Button
                            size="sm"
                            aria-label={`Send test to ${h.url}`}
                            loading={test.isSending(h.id)}
                            onClick={() => test.send(h.id)}
                          >
                            Send test
                          </Button>
                          <Button variant="danger" size="sm" onClick={() => setRemoving(h)}>
                            Remove
                          </Button>
                        </>
                      ) : null}
                    </div>
                  }
                >
                  <Text variant="mono" as="div" className={styles.url}>
                    {h.url}
                  </Text>
                  <div className={styles.meta}>
                    <ul aria-label="Events" className={styles.events}>
                      {h.events.map((event) => (
                        <li key={event}>
                          <Badge shape="tag">{event}</Badge>
                        </li>
                      ))}
                    </ul>
                    <Text variant="small" tone="secondary">
                      added <RelativeTime iso={h.createdAt} />
                    </Text>
                  </div>
                </ListRow>
              </li>
            ))}
          </ul>
        )}
        {remove.error && !removing ? <Banner tone="danger">{remove.error.message}</Banner> : null}
        {test.error ? <Banner tone="danger">{test.error.message}</Banner> : null}
        <TestResult state={test.state} hooks={props.hooks} />
      </SettingsSection>

      {props.hooks
        .filter((h) => h.deliveries.length > 0)
        .map((h) => (
          <SettingsSection
            key={h.id}
            title={`Recent deliveries to ${hostOf(h.url)}`}
            description="Any answer other than 2xx is retried. Redirects aren't followed."
            aria-label={`Recent deliveries to ${h.url}`}
          >
            <div className={styles.table} role="table" aria-label={`Deliveries to ${h.url}`}>
              <div className={`${styles.dl} ${styles.head}`} role="row">
                <span role="columnheader">Time</span>
                <span role="columnheader">Event</span>
                <span role="columnheader">Status</span>
                <span role="columnheader">Attempt</span>
              </div>
              {h.deliveries.map((d) => {
                const answer = deliveryAnswer(d)
                return (
                  <div key={`${d.deliveryId}-${d.attempt}`} className={styles.dl} role="row">
                    <Text variant="small" tone="secondary" role="cell">
                      <RelativeTime iso={d.createdAt} />
                    </Text>
                    <Text variant="mono" role="cell">
                      {d.event}
                      {d.test ? ' (test)' : ''}
                    </Text>
                    <Text variant="small" tone={answer.ok ? 'approved' : 'failed'} role="cell">
                      {answer.text}
                    </Text>
                    <Text variant="small" tone="secondary" role="cell">
                      {attemptLabel(d)}
                    </Text>
                  </div>
                )
              })}
            </div>
          </SettingsSection>
        ))}

      <SettingsSection
        title="Checking a delivery"
        bare
        description={
          <>
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
            , where{' '}
            <Text as="code" variant="mono">
              v1
            </Text>{' '}
            is HMAC-SHA256 of{' '}
            <Text as="code" variant="mono">
              {'<t>.<body>'}
            </Text>{' '}
            with the webhook's secret. Reject signatures older than 5 minutes.
          </>
        }
      />

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
            <Text>Webhook added. Use this secret to check each delivery's signature.</Text>
            <SecretBox label={`Signing secret for ${secret.url}`} value={secret.value} />
            <Text variant="small" tone="tertiary">
              Copy it now: it isn't shown again.
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
                <Text variant="small" tone="failed" role="alert">
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
              stops receiving build events right away. This can't be undone.
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

/**
 * Under the list: "Test sent" only while the result is unknown, then "Test delivered" (2xx) or
 * "Test failed" with the reason, from what the worker's delivery got.
 */
function TestResult({
  state,
  hooks,
}: {
  state: useWebhookTest.State | undefined
  hooks: readonly Webhooks.Hook[]
}) {
  if (!state) return null
  const url = hooks.find((h) => h.id === state.hookId)?.url
  if (!url) return null
  if (state.delivery) {
    const answer = deliveryAnswer(state.delivery)
    return (
      <Banner tone={answer.ok ? 'success' : 'danger'}>
        {answer.ok ? `Test delivered to ${url}: ${answer.text}` : `Test failed: ${answer.text}`}
      </Banner>
    )
  }
  return (
    <Banner tone="info">
      {state.gaveUp
        ? `Test sent to ${url}. No result yet: reload in a moment to see its delivery.`
        : `Test sent to ${url}. Waiting for its delivery…`}
    </Banner>
  )
}

/** The host of an address, for a heading; the whole text when it doesn't parse. */
function hostOf(url: string) {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

/** The delivery badge on a webhook's row, from its newest attempt. */
function HookBadge({ hook }: { hook: Webhooks.Hook }) {
  const status = hookStatus(hook.deliveries[0])
  if (status.kind === 'none') return <Badge shape="tag">No deliveries yet</Badge>
  if (status.kind === 'failing') {
    return (
      <Badge shape="tag" tone="state" state="failed">
        {status.text}
      </Badge>
    )
  }
  return (
    <Badge shape="tag" tone="state" state="approved">
      Delivered {/* The newest attempt's time. */}
      <RelativeTime iso={hook.deliveries[0]?.createdAt ?? hook.createdAt} />
    </Badge>
  )
}

namespace Webhooks {
  export interface Hook {
    id: string
    url: string
    events: string[]
    createdAt: string
    deliveries: Team.WebhookDelivery[]
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
