import type { Review } from '@circi/api'
import { Avatar, SettingsRow, SettingsSection, StatusChip, visuallyHidden } from '@circi/ui'
import type { MouseEventHandler, ReactNode } from 'react'

import { fileUrl } from '#features/builds/api/index.ts'
import { useTeamMark } from '#features/integrations/TeamMark.tsx'
import { RelativeTime } from '#lib/RelativeTime.tsx'
import { useClientLink } from '#lib/use-client-link.ts'

import { changeSummary, overdueLabel, requestRef, requestStatus, scoreLabel } from './api.ts'

import styles from './Reviews.module.css'

/** The selected review: its status, title, meta line, the Details box and the largest changes. */
export function ReviewDetail({ request: r, backHref, onBack, children }: ReviewDetail.Props) {
  const clientLink = useClientLink()
  const teamMark = useTeamMark(r.workspace.slug)
  const { status, label } = requestStatus(r)
  const overdue = overdueLabel(r.overdueByMs)
  const counts = changeSummary(r.changes)
  const buildLink = (shot?: string) =>
    clientLink({
      to: '/$workspace/$team/builds/$number',
      params: {
        workspace: r.workspace.slug,
        team: r.team.slug,
        number: String(r.build.number),
      },
      ...(shot ? { search: { shot } } : {}),
    })

  return (
    <div className={styles.detailBody}>
      <a className={styles.back} href={backHref} onClick={onBack}>
        Back to reviews
      </a>
      <div className={styles.head}>
        <StatusChip status={status}>{label}</StatusChip>
        <h2 className={styles.title}>Build #{r.build.number}</h2>
        <span className={styles.meta}>
          {teamMark(r.team.slug, r.team.name)}
          <span>{r.team.name}</span>
          <span aria-hidden="true">·</span>
          <span className={styles.mono}>{requestRef(r.build)}</span>
          {r.requestedBy ? (
            <>
              <span aria-hidden="true">·</span>
              <Avatar name={r.requestedBy.name} size={16} />
              <span>
                {r.requestedBy.name}, <RelativeTime iso={r.createdAt} />
              </span>
            </>
          ) : null}
        </span>
        {children ? <div className={styles.actions}>{children}</div> : null}
      </div>

      <SettingsSection title="Details">
        <SettingsRow label="Requested by">
          {r.requestedBy ? (
            <span className={styles.person}>
              <Avatar name={r.requestedBy.name} size={20} />
              {r.requestedBy.name}
            </span>
          ) : (
            'Someone who has left'
          )}
        </SettingsRow>
        <SettingsRow label="Reviewer">{r.reviewer.name}</SettingsRow>
        {r.dueAt ? (
          <SettingsRow label="Review target">
            {overdue ? `${overdue}, target ` : 'Due '}
            <RelativeTime iso={r.dueAt} />
          </SettingsRow>
        ) : null}
        <SettingsRow label="Branch">
          <span className={styles.mono}>{requestRef(r.build)}</span>
        </SettingsRow>
        {r.build.prNumber === null ? null : (
          <SettingsRow label="Pull request">#{r.build.prNumber}</SettingsRow>
        )}
        <SettingsRow label="Commit">
          <span className={styles.mono}>{r.build.commitSha.slice(0, 7)}</span>
        </SettingsRow>
        <SettingsRow label="Snapshots">
          <span className={styles.counts}>
            {counts.length === 0 ? (
              <span>No changes</span>
            ) : (
              counts.map((c) => <span key={c}>{c}</span>)
            )}
            <span>{r.changes.unchanged} same</span>
          </span>
        </SettingsRow>
      </SettingsSection>

      {r.largestChanges.length > 0 ? (
        <SettingsSection title="Largest changes" bare>
          <ul className={styles.thumbs}>
            {r.largestChanges.map((c) => {
              const link = buildLink(c.name)
              const sha = c.thumbnail ?? c.sha256
              return (
                <li key={c.name}>
                  <a className={styles.thumb} href={link.href} onClick={link.onClick}>
                    <span className={styles.shot}>
                      {sha ? <img src={fileUrl(sha)} alt="" loading="lazy" /> : null}
                    </span>
                    <span className={styles.thumbCaption}>
                      <span className={styles.thumbName}>
                        <span style={visuallyHidden}>Open {c.name} in build: </span>
                        {c.name}
                      </span>
                      <span className={styles.mono}>{scoreLabel(c.score)}</span>
                    </span>
                  </a>
                </li>
              )
            })}
          </ul>
        </SettingsSection>
      ) : null}
    </div>
  )
}

export namespace ReviewDetail {
  export interface Props {
    request: Review.Request
    /** Where the phone's "Back to reviews" link goes: the page without the selection. */
    backHref: string
    onBack: MouseEventHandler<HTMLElement>
    /** Secondary actions under the meta line (request a review, dismiss). */
    children?: ReactNode
  }
}
