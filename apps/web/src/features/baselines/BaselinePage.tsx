import { Button, EmptyState, Heading, ListRow, SettingsPage, StatusIcon, Text } from '@circi/ui'
import { useQuery } from '@tanstack/react-query'
import { useParams } from '@tanstack/react-router'
import { useId } from 'react'

import { screenshotLabel, screenshotStatus, shotReview } from '#features/builds/diff-status.ts'
import { IgnoreRegionsEditor } from '#features/regions/IgnoreRegionsEditor.tsx'
import { flakyQuery, settingsQuery } from '#features/teams/api/index.ts'
import { useCrumbNames } from '#features/teams/crumb-names.ts'
import { snapshotHistoryQuery } from '#features/triage/api.ts'
import { useDocumentTitle } from '#lib/document-title.ts'
import { ErrorState } from '#lib/ErrorState.tsx'
import { crumbsFor, PageHeading } from '#lib/PageHeading.tsx'
import { QuerySkeleton } from '#lib/QueryBoundary.tsx'
import { RelativeTime } from '#lib/RelativeTime.tsx'
import { useClientLink } from '#lib/use-client-link.ts'

import { baselineOf, baselinesQuery, changesOf, HISTORY_LENGTH } from './api.ts'
import { BASELINE_ROUTE } from './routes.ts'

import styles from './BaselinePage.module.css'

/**
 * One screenshot's baseline: the approved image builds on the default branch are compared with,
 * where it came from and who approved it, its ignore regions (edited here by owners and admins),
 * and the recent builds where it changed.
 */
export function BaselinePage() {
  const { workspace, team, _splat } = useParams({ from: BASELINE_ROUTE })
  const name = _splat ?? ''
  const names = useCrumbNames(workspace, team)
  const clientLink = useClientLink()
  useDocumentTitle(name, 'Baselines', team)
  const baselines = useQuery(baselinesQuery(workspace, team))
  const settings = useQuery(settingsQuery(workspace, team))
  const flaky = useQuery(flakyQuery(workspace, team))
  const historyHeading = useId()
  const error = baselines.error ?? settings.error

  const defaultBranch = baselines.data?.team.defaultBranch ?? settings.data?.settings.defaultBranch
  const baseline = baselines.data ? baselineOf(baselines.data.baselines, name) : undefined
  const flakyEntry = flaky.data?.flaky.find((f) => f.name === name)

  return (
    <>
      <PageHeading
        crumbs={crumbsFor(names, [
          {
            label: 'Baselines',
            link: { to: '/$workspace/$team/baselines', params: { workspace, team } },
          },
        ])}
        title={name}
      />
      <SettingsPage width="wide">
        {error ? (
          <ErrorState
            error={error}
            onRetry={() => {
              void baselines.refetch()
              void settings.refetch()
            }}
            notFound="This team doesn't exist"
          />
        ) : !baselines.data || !settings.data || !defaultBranch ? (
          <QuerySkeleton rows={4} />
        ) : (
          <>
            <header className={styles.header}>
              <div className={styles.headerText}>
                <Text variant="mono" className={styles.name}>
                  {name}
                </Text>
                {flakyEntry ? (
                  <Text variant="small" className={styles.flaky}>
                    <StatusIcon status="flaky" label="Flaky" />
                    Flaky: changed in {flakyEntry.changedIn} of the last {flaky.data?.builds} builds
                  </Text>
                ) : null}
                {baseline ? (
                  <>
                    <Text as="p" tone="secondary" className={styles.line}>
                      Baseline from build #{baseline.buildNumber} on {defaultBranch}
                    </Text>
                    <Text as="p" variant="small" tone="tertiary" className={styles.line}>
                      {baseline.approvedBy ? `Approved by ${baseline.approvedBy.name}` : 'Approved'}{' '}
                      <RelativeTime iso={baseline.approvedAt} />
                    </Text>
                  </>
                ) : (
                  <Text as="p" tone="secondary" className={styles.line}>
                    No approved screenshot with this name on {defaultBranch} yet.
                  </Text>
                )}
              </div>
              {baseline ? (
                <Button
                  {...clientLink({
                    to: '/$workspace/$team/builds/$number',
                    params: { workspace, team, number: String(baseline.buildNumber) },
                  })}
                >
                  Open build
                </Button>
              ) : null}
            </header>

            <IgnoreRegionsEditor
              workspace={workspace}
              team={team}
              name={name}
              latest={
                baseline
                  ? {
                      buildNumber: baseline.buildNumber,
                      sha256: baseline.fileSha256,
                      width: baseline.width,
                      height: baseline.height,
                    }
                  : null
              }
              defaultBranch={defaultBranch}
              canManage={settings.data.canManage}
            />

            <section aria-labelledby={historyHeading} className={styles.history}>
              <div className={styles.historyBar}>
                <Heading as="h2" id={historyHeading} className={styles.historyTitle}>
                  History on {defaultBranch}
                </Heading>
              </div>
              <History
                workspace={workspace}
                team={team}
                name={name}
                defaultBranch={defaultBranch}
              />
            </section>
          </>
        )}
      </SettingsPage>
    </>
  )
}

function History({ workspace, team, name, defaultBranch }: History.Props) {
  const clientLink = useClientLink()
  const { data, error, refetch } = useQuery(
    snapshotHistoryQuery(workspace, team, name, undefined, HISTORY_LENGTH),
  )
  if (error) return <ErrorState error={error} onRetry={() => void refetch()} />
  if (!data) return <QuerySkeleton rows={2} />
  const changes = changesOf(data.default)
  if (changes.length === 0) {
    return <EmptyState title={`No changes in the recent builds on ${defaultBranch}`} />
  }
  return (
    <ul aria-label={`Recent changes of ${name}`} className={styles.rows}>
      {changes.map((entry) => {
        const kind = entry.status ?? 'unchanged'
        const review = shotReview(entry.build)
        return (
          <li key={entry.build.number}>
            <ListRow
              {...clientLink({
                to: '/$workspace/$team/builds/$number',
                params: { workspace, team, number: String(entry.build.number) },
                search: { shot: name },
              })}
              leading={
                <StatusIcon
                  status={screenshotStatus(kind, review)}
                  label={screenshotLabel(kind, review)}
                />
              }
              trailing={
                <Text variant="small" tone="tertiary">
                  <RelativeTime iso={entry.build.createdAt} />
                </Text>
              }
            >
              <span className={styles.row}>
                <span className={styles.build}>#{entry.build.number}</span>
                <Text truncate>{screenshotLabel(kind, review)}</Text>
              </span>
            </ListRow>
          </li>
        )
      })}
    </ul>
  )
}

namespace History {
  export interface Props {
    workspace: string
    team: string
    name: string
    defaultBranch: string
  }
}
