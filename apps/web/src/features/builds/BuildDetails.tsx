import type { Build } from '@circi/api'
import { Avatar, Text } from '@circi/ui'

import { RelativeTime } from '#lib/RelativeTime.tsx'

import { BuildStateLabel } from './BuildStateLabel.tsx'
import { baselineHow, type ReviewRequest, reviewTargetStatus } from './review-model.ts'

import styles from './Discussion.module.css'

/**
 * The top of the Details tab on a phone, whose header has no status chips: the state, the review
 * target and the watchers. Reviewers are under People.
 */
export function PhoneFacts({ data, watching, now }: PhoneFacts.Props) {
  const { build, baseline } = data
  const target = reviewTargetStatus(data.reviewTarget, now)
  return (
    <dl className={styles.facts}>
      <Text as="dt" variant="small" tone="secondary">
        Status
      </Text>
      <dd className={styles.fact}>
        <BuildStateLabel build={build} hasBaseline={baseline !== null} />
      </dd>
      <Text as="dt" variant="small" tone="secondary">
        Review target
      </Text>
      <Text as="dd" tone={target?.overdue ? 'failed' : 'primary'}>
        {target
          ? target.long
          : data.reviewTarget.hours === null
            ? 'None'
            : `${data.reviewTarget.hours}h`}
      </Text>
      <Text as="dt" variant="small" tone="secondary">
        Watchers
      </Text>
      <Text as="dd" title={data.watchers.map((w) => w.name).join(', ')}>
        {data.watchers.length > 0
          ? `${data.watchers.length}${watching ? " · you're watching" : ''}`
          : 'Nobody'}
      </Text>
    </dl>
  )
}

export namespace PhoneFacts {
  export interface Props {
    data: Build.Detail
    watching: boolean
    now: number
  }
}

/** What the build is: its pull request, commit, branch, when it was uploaded and what it was compared with. */
export function BuildSection({ data }: BuildSection.Props) {
  const { build, baseline, pullRequest, project } = data
  return (
    <section aria-label="Build">
      <Text variant="micro" tone="tertiary">
        Build
      </Text>
      <dl className={styles.facts}>
        {pullRequest ? (
          <>
            <Text as="dt" variant="small" tone="secondary">
              Pull request
            </Text>
            <Text as="dd" variant="mono">
              {pullRequest.repo ? `${pullRequest.repo}#` : '#'}
              {pullRequest.number}
            </Text>
          </>
        ) : null}
        <Text as="dt" variant="small" tone="secondary">
          Commit
        </Text>
        <Text as="dd" variant="mono" title={build.commitSha}>
          {build.commitSha.slice(0, 7)}
        </Text>
        {build.branch ? (
          <>
            <Text as="dt" variant="small" tone="secondary">
              Branch
            </Text>
            <Text as="dd" variant="mono">
              {build.branch}
            </Text>
          </>
        ) : null}
        <Text as="dt" variant="small" tone="secondary">
          Uploaded
        </Text>
        <Text as="dd">
          <RelativeTime iso={build.createdAt} />
        </Text>
        <Text as="dt" variant="small" tone="secondary">
          Baseline
        </Text>
        <Text as="dd">
          {baseline ? (
            <>
              build #{baseline.number} on {baseline.branch ?? 'an unknown branch'}
              <Text variant="small" tone="secondary" as="p" title={baseline.commitSha}>
                {baselineHow(build, project.defaultBranch)}
              </Text>
            </>
          ) : (
            'Nothing yet'
          )}
        </Text>
      </dl>
    </section>
  )
}

export namespace BuildSection {
  export interface Props {
    data: Build.Detail
  }
}

/** Who has an open review request, with who asked and when; "Assigned automatically" when no one did. */
export function PeopleSection({ requests }: PeopleSection.Props) {
  return (
    <section aria-label="People">
      <Text variant="micro" tone="tertiary">
        People
      </Text>
      {requests.length === 0 ? (
        <Text as="p" tone="secondary">
          No one asked yet
        </Text>
      ) : (
        <ul className={styles.list}>
          {requests.map((r) => (
            <li key={r.person.id} className={styles.event}>
              <Avatar type="user" {...r.person} size={20} />
              <div className={styles.eventBody}>
                <Text>{r.person.name}</Text>
                <Text variant="small" tone="secondary">
                  {r.by ? (
                    <>
                      Asked by {r.by.name} <RelativeTime iso={r.at} />
                    </>
                  ) : (
                    <>
                      Assigned automatically <RelativeTime iso={r.at} />
                    </>
                  )}
                </Text>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

export namespace PeopleSection {
  export interface Props {
    requests: readonly ReviewRequest[]
  }
}
