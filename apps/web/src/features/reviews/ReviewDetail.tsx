import type { Review } from '@circi/api'
import { isAwaited } from '@circi/core'
import {
  ArrowRightIcon,
  Avatar,
  Button,
  ListGroup,
  ScrollArea,
  SettingsRow,
  SettingsSection,
  StatusChip,
  StatusIcon,
  visuallyHidden,
} from '@circi/ui'
import type { MouseEventHandler, ReactNode } from 'react'

import { fileUrl } from '#features/builds/api/index.ts'
import { useProjectMark } from '#features/integrations/ProjectMark.tsx'
import { RelativeTime } from '#lib/RelativeTime.tsx'
import { useClientLink } from '#lib/use-client-link.ts'

import {
  baselineLabel,
  changeSizeGroups,
  changeSummary,
  decisionLabel,
  requestRef,
  requestStatus,
  scoreLabel,
} from './api.ts'

import styles from './Reviews.module.css'

/** The one face every request by someone who has left shares (the same as a comment's). */
const LEFT_MEMBER_ID = 'left-member'

/**
 * The selected review: the status icon and title with its actions, the meta line, then the Details
 * beside the largest changes (each scrolls on its own; stacked on a narrow pane).
 */
export function ReviewDetail({ request: r, backHref, onBack, children }: ReviewDetail.Props) {
  const clientLink = useClientLink()
  const projectMark = useProjectMark(r.workspace.slug)
  const { status, label } = requestStatus(r)
  const counts = changeSummary(r.changes)
  // The live person when they still resolve (so renames show), else the name kept on the request.
  const asker =
    r.requestedBy ??
    (r.requestedByName ? { id: LEFT_MEMBER_ID, name: r.requestedByName, image: null } : null)
  const buildLink = (shot?: string) =>
    clientLink({
      to: '/$workspace/$project/builds/$number',
      params: {
        workspace: r.workspace.slug,
        project: r.project.slug,
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
        <div className={styles.titleRow}>
          <StatusIcon status={status} label={label} size={18} />
          <h2 className={styles.title}>Build #{r.build.number}</h2>
          {children ? <div className={styles.actions}>{children}</div> : null}
          <Button variant="primary" size="sm" className={styles.go} {...buildLink()}>
            Go to review
            <ArrowRightIcon size={16} />
          </Button>
        </div>
        <span className={styles.meta}>
          {projectMark(r.project.slug, r.project.name)}
          <span>{r.project.name}</span>
          <span aria-hidden="true">·</span>
          <span className={styles.mono}>{requestRef(r.build)}</span>
          {r.flakyChanges > 0 ? (
            <span
              className={styles.flaky}
              title={`${plural(r.flakyChanges, 'changed screenshot')} known to be flaky`}
            >
              <StatusIcon status="flaky" size={12} decorative />
              Flaky
            </span>
          ) : null}
          {asker ? (
            <>
              <span aria-hidden="true">·</span>
              <Avatar type="user" {...asker} size={16} />
              <span>
                {asker.name}, <RelativeTime iso={r.createdAt} />
              </span>
            </>
          ) : null}
        </span>
      </div>

      <div className={styles.cols}>
        <ScrollArea rootClassName={styles.col} className={styles.colScroll}>
          <SettingsSection title="Details">
            <SettingsRow className={styles.fact} label="Requested by">
              {asker ? (
                <span className={styles.person}>
                  <Avatar type="user" {...asker} size={20} />
                  {asker.name}
                </span>
              ) : (
                'Assigned automatically'
              )}
            </SettingsRow>
            <SettingsRow className={styles.fact} label="Reviewer">
              {r.reviewer.name}
            </SettingsRow>
            {decisionLabel(r) && r.closedAt ? (
              <SettingsRow className={styles.fact} label="Decision">
                <span>
                  {decisionLabel(r)}, <RelativeTime iso={r.closedAt} />
                </span>
              </SettingsRow>
            ) : null}
            {r.dueAt && isAwaited(r, r.build) ? (
              <SettingsRow className={styles.fact} label="Review target">
                {/* One inline span: the control is a flex row, which would add a gap after the text. */}
                <span>
                  Due <RelativeTime iso={r.dueAt} />
                </span>
              </SettingsRow>
            ) : null}
            <SettingsRow className={styles.fact} label="Branch">
              <span className={styles.mono}>{requestRef(r.build)}</span>
            </SettingsRow>
            {baselineLabel(r) ? (
              <SettingsRow className={styles.fact} label="Compared with">
                <span className={styles.mono}>{baselineLabel(r)}</span>
              </SettingsRow>
            ) : null}
            {r.build.prNumber === null ? null : (
              <SettingsRow className={styles.fact} label="Pull request">
                #{r.build.prNumber}
              </SettingsRow>
            )}
            <SettingsRow className={styles.fact} label="Commit">
              <span className={styles.mono}>{r.build.commitSha.slice(0, 7)}</span>
            </SettingsRow>
            <SettingsRow className={styles.fact} label="Screenshots">
              <span className={styles.counts}>
                {counts.length === 0 && r.changes.failed === 0 ? (
                  <span>No changes</span>
                ) : (
                  counts.map((c) => <span key={c}>{c}</span>)
                )}
                {r.changes.failed > 0 ? (
                  <StatusChip status="failed">{r.changes.failed} couldn't be read</StatusChip>
                ) : null}
                <span>{r.changes.unchanged} same</span>
              </span>
            </SettingsRow>
          </SettingsSection>
        </ScrollArea>

        <ScrollArea rootClassName={styles.col} className={styles.colScroll}>
          <div className={styles.changes}>
            {r.changedScreenshots.length > 0 ? (
              <SettingsSection title="Changes" bare>
                {changeSizeGroups(r.changedScreenshots, r.project.diffThreshold).map((g) => (
                  <section
                    key={g.size}
                    className={styles.sizeGroup}
                    aria-label={`${g.label} changes`}
                  >
                    <ListGroup level={3} label={g.label} count={g.items.length} />
                    <ul className={styles.thumbs}>
                      {g.items.map((c) => {
                        const link = buildLink(c.name)
                        // One or two to a row are wider than a thumbnail (480px): the full image.
                        const sha =
                          g.items.length < 3 ? (c.sha256 ?? c.thumbnail) : (c.thumbnail ?? c.sha256)
                        return (
                          <li key={c.name}>
                            <a className={styles.thumb} href={link.href} onClick={link.onClick}>
                              <span className={styles.thumbCaption}>
                                <span className={styles.thumbName}>
                                  <span style={visuallyHidden}>Open {c.name} in build: </span>
                                  {c.name}
                                </span>
                                <span className={styles.mono}>{scoreLabel(c.score)}</span>
                              </span>
                              <span className={styles.shot}>
                                {sha ? <img src={fileUrl(sha)} alt="" loading="lazy" /> : null}
                              </span>
                            </a>
                          </li>
                        )
                      })}
                    </ul>
                  </section>
                ))}
              </SettingsSection>
            ) : null}
          </div>
        </ScrollArea>
      </div>
    </div>
  )
}

const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`

export namespace ReviewDetail {
  export interface Props {
    request: Review.Request
    /** Where the phone's "Back to reviews" link goes: the page without the selection. */
    backHref: string
    onBack: MouseEventHandler<HTMLElement>
    /** The icon buttons in the title row (snooze, dismiss). */
    children?: ReactNode
  }
}
