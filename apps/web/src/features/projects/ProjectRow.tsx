import type { Project } from '@circi/api'
import { Avatar, ListRow, StatusIcon, Text, visuallyHidden } from '@circi/ui'

import { buildState } from '#features/builds/build-state.ts'
import { RelativeTime } from '#lib/RelativeTime.tsx'
import { useClientLink } from '#lib/use-client-link.ts'

import { MemberStack } from './AvatarStack.tsx'
import { changesCell } from './list.ts'
import { ProjectContextMenu } from './ProjectContextMenu.tsx'

import styles from './ProjectsPage.module.css'

/** One project of the Projects page: its tile and address, members, latest build, changes and age; a link to its builds. */
export function ProjectRow({ item: { workspace: owner, project, latestBuild } }: ProjectRow.Props) {
  const clientLink = useClientLink()
  const state = latestBuild ? buildState(latestBuild) : null
  const cell = latestBuild ? changesCell(latestBuild) : null
  return (
    <ProjectContextMenu workspace={owner.slug} project={project.slug}>
      <ListRow
        className={styles.row}
        {...clientLink({
          to: '/$workspace/$project',
          params: { workspace: owner.slug, project: project.slug },
        })}
      >
        <span className={styles.grid}>
          <span className={styles.nameCol}>
            <Avatar
              type="project"
              aria-hidden
              slug={project.slug}
              name={project.name}
              color={project.color}
              icon={project.icon}
              size={24}
            />
            <span className={styles.names}>
              <span className={styles.title}>{project.name}</span>
              <span className={styles.subtitle}>
                {owner.slug}/{project.slug}
              </span>
            </span>
          </span>
          <span className={styles.members}>
            <MemberStack count={project.memberCount} people={project.memberPreview} />
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
    </ProjectContextMenu>
  )
}

export namespace ProjectRow {
  export interface Props {
    item: Project.Overview
  }
}
