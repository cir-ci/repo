import type { Team } from '@circi/api'
import { Avatar, ListRow, StatusIcon, Text, visuallyHidden } from '@circi/ui'

import { buildState } from '#features/builds/build-state.ts'
import { RelativeTime } from '#lib/RelativeTime.tsx'
import { useClientLink } from '#lib/use-client-link.ts'

import { MemberStack } from './AvatarStack.tsx'
import { changesCell } from './list.ts'

import styles from './TeamsPage.module.css'

/** One team of the Teams page: its tile and address, members, latest build, changes and age; a link to its builds. */
export function TeamRow({ item: { workspace: owner, team, latestBuild } }: TeamRow.Props) {
  const clientLink = useClientLink()
  const state = latestBuild ? buildState(latestBuild) : null
  const cell = latestBuild ? changesCell(latestBuild) : null
  return (
    <ListRow
      className={styles.row}
      {...clientLink({
        to: '/$workspace/$team',
        params: { workspace: owner.slug, team: team.slug },
      })}
    >
      <span className={styles.grid}>
        <span className={styles.nameCol}>
          <Avatar
            type="team"
            aria-hidden
            slug={team.slug}
            name={team.name}
            color={team.color}
            icon={team.icon}
            size={24}
          />
          <span className={styles.names}>
            <span className={styles.title}>{team.name}</span>
            <span className={styles.subtitle}>
              {owner.slug}/{team.slug}
            </span>
          </span>
        </span>
        <span className={styles.members}>
          <MemberStack count={team.memberCount} people={team.memberPreview} />
        </span>
        <span className={styles.latest}>
          {latestBuild && state ? (
            <>
              <StatusIcon status={state.status} label={state.label} />
              <span>#{latestBuild.number}</span>
              {latestBuild.branch ? (
                <span className={styles.branch}>{latestBuild.branch}</span>
              ) : null}
            </>
          ) : (
            <>
              <StatusIcon status="neutral" label="No builds yet" />
              <Text variant="small" tone="secondary">
                No builds yet
              </Text>
            </>
          )}
        </span>
        <span className={styles.changes}>
          {cell?.kind === 'counts' ? (
            <span className={styles.counts}>
              {cell.counts.map((c) => (
                <span key={c.glyph} title={c.title}>
                  <span aria-hidden="true">
                    {c.glyph}
                    {c.count}
                  </span>
                  <span style={visuallyHidden}>{c.title}</span>
                </span>
              ))}
            </span>
          ) : cell ? (
            <Text variant="small" tone="tertiary">
              {cell.text}
            </Text>
          ) : null}
        </span>
        <span className={styles.updated}>
          {latestBuild ? (
            <Text variant="small" tone="tertiary">
              <RelativeTime iso={latestBuild.createdAt} />
            </Text>
          ) : null}
        </span>
      </span>
    </ListRow>
  )
}

export namespace TeamRow {
  export interface Props {
    item: Team.Overview
  }
}
