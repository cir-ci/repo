import type { InstanceAdmin } from '@circi/api'
import {
  Badge,
  Button,
  RefreshIcon,
  SettingsRow,
  SettingsSection,
  SettingsSummary,
  Text,
} from '@circi/ui'
import { useIsFetching, useQuery, useQueryClient } from '@tanstack/react-query'
import { Fragment, useState } from 'react'

import { setupQuery } from '#features/auth/api.ts'
import { useDocumentTitle } from '#lib/document-title.ts'
import { ErrorState } from '#lib/ErrorState.tsx'

import { AdminFrame, Intro } from './AdminFrame.tsx'
import {
  checklistQuery,
  checksQuery,
  findingCounts,
  findingHost,
  FINDING_LEVEL,
  findingsSummary,
  formatAge,
  groupFindings,
  isForbidden,
  queuesQuery,
  queueTotals,
  stepDone,
} from './api/admin.ts'

/** The doctor's checks in groups, the address-change checklist, the job queues and the setup code. */
export function HealthPage() {
  useDocumentTitle('Health', 'Instance')
  const queryClient = useQueryClient()
  const checks = useQuery(checksQuery())
  const fetching = useIsFetching({ queryKey: ['instance-health'] }) > 0
  // The queue and checklist are cheap; the checks ask other hosts and may be slow.
  const queues = useQuery(queuesQuery())
  const checklist = useQuery(checklistQuery())
  const setup = useQuery(setupQuery())
  const [now, setNow] = useState(() => Date.now())

  // A 403 on any of the three means the viewer is not an instance admin.
  const forbidden = [checks, queues, checklist].map((q) => q.error).find(isForbidden)
  const first = !queues.data && !queues.error

  function refresh() {
    setNow(Date.now())
    void queryClient.invalidateQueries({ queryKey: ['instance-health'] })
  }

  const groups = checks.data ? groupFindings(checks.data.findings) : undefined

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
      <SummarySection checks={checks.data} loading={checks.isFetching} />
      {checks.error && !checks.data ? (
        <SettingsSection title="Checks" bare>
          <ErrorState error={checks.error} onRetry={refresh} />
        </SettingsSection>
      ) : null}
      {groups && groups.services.length > 0 ? (
        <SettingsSection
          title="Services"
          description="What CirCI needs running to build and store."
        >
          {groups.services.map((f) => (
            <FindingRow key={f.id} finding={f} />
          ))}
        </SettingsSection>
      ) : null}
      {groups ? (
        <SettingsSection
          title="Domains and cookies"
          description="Best effort: CirCI can only check the hosts it knows about."
        >
          {groups.domains.map((f) => (
            <FindingRow key={f.id} finding={f} />
          ))}
          <SettingsRow detail="Nothing on the dashboard’s parent domain may set a cookie for the whole domain, and nothing but CirCI may live on the sites domain." />
        </SettingsSection>
      ) : null}
      <ChecklistSection checklist={checklist.data} />
      <QueuesSection queues={queues.data?.queues} error={queues.error} now={now} />
      {setup.data ? (
        <SettingsSection title="Setup code">
          <SettingsRow
            label="Setup page"
            detail="Only needed on a fresh install. On a new server the code is in the server log, or from circi admin setup-code."
            value={setup.data.needed ? 'open' : 'closed'}
            status={
              <Badge shape="tag" tone="state" state={setup.data.needed ? 'review' : 'approved'}>
                {setup.data.needed ? 'Not set up' : 'Set up'}
              </Badge>
            }
          />
        </SettingsSection>
      ) : null}
    </AdminFrame>
  )
}

function SummarySection(props: { checks: InstanceAdmin.Checks | undefined; loading: boolean }) {
  const { checks } = props
  return (
    <SettingsSection
      title="Summary"
      description={
        checks
          ? findingsSummary(checks.findings)
          : props.loading
            ? 'Running the checks. They ask other hosts, so this can take a few seconds.'
            : undefined
      }
      bare
    >
      {checks ? (
        <SummaryCounts findings={checks.findings} />
      ) : (
        <Text tone="secondary">Running…</Text>
      )}
    </SettingsSection>
  )
}

function SummaryCounts(props: { findings: InstanceAdmin.Finding[] }) {
  const counts = findingCounts(props.findings)
  return (
    <SettingsSummary
      items={[
        {
          label: 'Passing',
          value: counts.passing,
          extra: (
            <Badge shape="tag" tone="state" state="approved">
              Passing
            </Badge>
          ),
        },
        {
          label: 'Need a look',
          value: counts.warned,
          extra: (
            <Badge shape="tag" tone="state" state="review">
              Check
            </Badge>
          ),
        },
        {
          label: 'Notes',
          value: counts.notes,
          extra: (
            <Badge shape="tag" tone="state" state="processing">
              Note
            </Badge>
          ),
        },
      ]}
    />
  )
}

function FindingRow({ finding: f }: { finding: InstanceAdmin.Finding }) {
  const host = findingHost(f)
  return (
    <SettingsRow
      label={f.message}
      detail={f.fix ? `How to fix: ${f.fix}` : undefined}
      value={host}
      status={
        <Badge shape="tag" tone="state" state={FINDING_LEVEL[f.level].state}>
          {FINDING_LEVEL[f.level].label}
        </Badge>
      }
    />
  )
}

function ChecklistSection(props: { checklist: InstanceAdmin.AddressChecklist | undefined }) {
  const { checklist } = props
  if (!checklist) return null
  return (
    <SettingsSection
      title={`Moving to ${hostOf(checklist.publicUrl)}`}
      description={`CirCI is at ${checklist.publicUrl}. When PUBLIC_URL changes, old links redirect, but a few registrations outside CirCI still name the old address.`}
    >
      {checklist.steps.map((step, i) => {
        const done = stepDone(step)
        return (
          <SettingsRow
            key={step.id}
            leading={i + 1}
            label={step.title}
            detail={step.detail}
            value={
              step.values.length > 0
                ? step.values.map((v, n) => (
                    <Fragment key={v}>
                      {n > 0 ? <br /> : null}
                      {v}
                    </Fragment>
                  ))
                : undefined
            }
            status={
              <Badge shape="tag" tone={done ? 'state' : 'neutral'} state="approved">
                {done ? 'Done' : 'To do'}
              </Badge>
            }
          />
        )
      })}
    </SettingsSection>
  )
}

function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

function QueuesSection(props: {
  queues: InstanceAdmin.QueueDepth[] | undefined
  error: Error | null
  now: number
}) {
  const { queues } = props
  if (props.error && !queues) {
    return (
      <SettingsSection title="Background jobs" bare>
        <ErrorState error={props.error} />
      </SettingsSection>
    )
  }
  if (!queues) return null
  const totals = queueTotals(queues)
  return (
    <>
      <SettingsSection
        title="Background jobs"
        description="Diffs, thumbnails, checks and webhooks wait here for a worker."
        bare
      >
        <SettingsSummary
          items={[
            { label: 'Waiting', value: totals.pending },
            { label: 'Running', value: totals.running },
            {
              label: 'Oldest waiting',
              value: totals.oldestPendingAt ? formatAge(totals.oldestPendingAt, props.now) : 'None',
              extra: totals.oldestQueue ?? undefined,
            },
            { label: 'Failed', value: totals.failed },
          ]}
        />
      </SettingsSection>
      <SettingsSection title="Queues">
        {queues.map((q) => (
          <SettingsRow
            key={q.queue}
            label={q.queue}
            value={`${q.pending} waiting · ${q.running} running · ${q.failed} failed`}
          />
        ))}
      </SettingsSection>
    </>
  )
}
