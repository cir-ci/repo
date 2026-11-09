import type { InstanceAdmin } from '@circi/api'
import { Badge, Button, EmptyState, RefreshIcon, SectionHeader, Text } from '@circi/ui'
import { useIsFetching, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { useDocumentTitle } from '#lib/document-title.ts'
import { ErrorState } from '#lib/ErrorState.tsx'

import { AdminFrame, Intro } from './AdminFrame.tsx'
import {
  checklistQuery,
  checksQuery,
  FINDING_LEVEL,
  findingsSummary,
  formatAge,
  isForbidden,
  queuesQuery,
  queueTotals,
  sortFindings,
} from './api/admin.ts'

import styles from './Admin.module.css'

/** The doctor's checks, the address-change checklist and the job queues. */
export function HealthPage() {
  useDocumentTitle('Health', 'Instance')
  const queryClient = useQueryClient()
  const checks = useQuery(checksQuery())
  const fetching = useIsFetching({ queryKey: ['instance-health'] }) > 0
  // The queue and checklist are cheap; the checks ask other hosts and may be slow.
  const queues = useQuery(queuesQuery())
  const checklist = useQuery(checklistQuery())
  const [now, setNow] = useState(() => Date.now())

  // A 403 on any of the three means the viewer is not an instance admin.
  const forbidden = [checks, queues, checklist].map((q) => q.error).find(isForbidden)
  const first = !queues.data && !queues.error

  function refresh() {
    setNow(Date.now())
    void queryClient.invalidateQueries({ queryKey: ['instance-health'] })
  }

  return (
    <AdminFrame title="Health" loading={first} error={forbidden ?? null} onRetry={refresh}>
      <Intro
        action={
          <Button leading={<RefreshIcon />} loading={fetching} onClick={refresh}>
            Run checks again
          </Button>
        }
      >
        The same checks as circi admin doctor on the server.
      </Intro>
      <ChecksSection
        checks={checks.data}
        error={checks.error}
        loading={checks.isFetching}
        onRetry={refresh}
      />
      <QueuesSection queues={queues.data?.queues} error={queues.error} now={now} />
      <ChecklistSection checklist={checklist.data} />
    </AdminFrame>
  )
}

function ChecksSection(props: {
  checks: InstanceAdmin.Checks | undefined
  error: Error | null
  loading: boolean
  onRetry: () => void
}) {
  const { checks, error } = props
  return (
    <section className={styles.section} aria-label="Checks">
      <SectionHeader
        title="Checks"
        description={
          checks
            ? findingsSummary(checks.findings)
            : props.loading
              ? 'Running the checks. They ask other hosts, so this can take a few seconds.'
              : undefined
        }
      />
      {error && !checks ? (
        <ErrorState error={error} onRetry={props.onRetry} />
      ) : checks && checks.findings.length === 0 ? (
        <EmptyState title="No checks ran" />
      ) : (
        <div className={styles.box}>
          {checks ? (
            sortFindings(checks.findings).map((f) => (
              <div key={f.id} className={styles.boxRow}>
                <span className={styles.grow}>
                  <Text>{f.message}</Text>
                  {f.fix ? (
                    <Text tone="tertiary" variant="small">
                      How to fix: {f.fix}
                    </Text>
                  ) : null}
                </span>
                <Badge shape="tag" tone="state" state={FINDING_LEVEL[f.level].state}>
                  {FINDING_LEVEL[f.level].label}
                </Badge>
              </div>
            ))
          ) : (
            <div className={styles.boxRow}>
              <Text tone="secondary">Running…</Text>
            </div>
          )}
        </div>
      )}
      <Text tone="tertiary" variant="small">
        The cookie check is best effort: CirCI can only fetch the hosts it knows about. Nothing on
        your dashboard’s parent domain may set a cookie for the whole domain, and nothing but CirCI
        may live on the sites domain.
      </Text>
    </section>
  )
}

function ChecklistSection(props: { checklist: InstanceAdmin.AddressChecklist | undefined }) {
  const { checklist } = props
  if (!checklist) return null
  return (
    <section className={styles.section} aria-label="If the dashboard address changes">
      <SectionHeader
        title="If the dashboard address changes"
        description={`CirCI is at ${checklist.publicUrl}. When PUBLIC_URL changes, these still name the old address.`}
      />
      <ol className={styles.steps}>
        {checklist.steps.map((step) => (
          <li key={step.id}>
            <Text>{step.title}</Text>
            <br />
            <Text tone="secondary" variant="small">
              {step.detail}
            </Text>
            {step.values.length > 0 ? (
              <span className={styles.values}>
                {step.values.map((v) => (
                  <Text key={v} variant="mono" tone="secondary">
                    {v}
                  </Text>
                ))}
              </span>
            ) : null}
          </li>
        ))}
      </ol>
    </section>
  )
}

function QueuesSection(props: {
  queues: InstanceAdmin.QueueDepth[] | undefined
  error: Error | null
  now: number
}) {
  const { queues } = props
  if (props.error && !queues) {
    return (
      <section className={styles.section} aria-label="Background jobs">
        <SectionHeader title="Background jobs" />
        <ErrorState error={props.error} />
      </section>
    )
  }
  if (!queues) return null
  const totals = queueTotals(queues)
  return (
    <section className={styles.section} aria-label="Background jobs">
      <SectionHeader
        title="Background jobs"
        description="Diffs, thumbnails, checks and webhooks wait here for a worker."
      />
      <div className={`${styles.box} ${styles.stats}`}>
        <Stat label="Waiting" value={String(totals.pending)} />
        <Stat label="Running" value={String(totals.running)} />
        <Stat
          label="Oldest waiting"
          value={totals.oldestPendingAt ? formatAge(totals.oldestPendingAt, props.now) : 'None'}
          note={totals.oldestQueue ?? undefined}
        />
        <Stat label="Failed" value={String(totals.failed)} />
      </div>
      <div className={styles.box}>
        {queues.map((q) => (
          <div key={q.queue} className={styles.boxRow}>
            <Text className={styles.grow} variant="mono">
              {q.queue}
            </Text>
            <Text tone="secondary" variant="small">
              {q.pending} waiting · {q.running} running · {q.failed} failed
            </Text>
          </div>
        ))}
      </div>
    </section>
  )
}

function Stat(props: { label: string; value: string; note?: string | undefined }) {
  return (
    <div className={styles.stat}>
      <Text tone="tertiary" variant="small">
        {props.label}
      </Text>
      <span className={styles.big}>{props.value}</span>
      {props.note ? (
        <Text tone="tertiary" variant="small">
          {props.note}
        </Text>
      ) : null}
    </div>
  )
}
