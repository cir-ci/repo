import { BuildingIcon, Button, EmptyState, LayersIcon, Ref, Text } from '@circi/ui'

import { useOverlayStore } from '#lib/stores/overlay-store.ts'

import styles from './TeamsEmpty.module.css'

/**
 * The Teams page with no team yet (the canvas's "Empty states · Teams" board): one empty state
 * for what the person can do about it. Owners and admins create the first team, and, for people
 * coming from Argos, a footnote gives the one variable that points the Argos SDK at this server.
 * Everyone else is told whom to ask, with no button.
 */
export function TeamsEmpty({ canCreateTeam, canCreateWorkspace, hasWorkspace }: TeamsEmpty.Props) {
  const setNewWorkspaceOpen = useOverlayStore((s) => s.setNewWorkspaceOpen)

  if (canCreateTeam) {
    return (
      <div className={styles.root}>
        <EmptyState icon={<LayersIcon />} title="Create your first team" className={styles.top}>
          A team is one app or library whose screenshots your CI uploads.
        </EmptyState>
        <div className={styles.argos}>
          <Text as="p" variant="small" tone="secondary">
            Already uploading with Argos? Point the Argos SDK at this server:
          </Text>
          <Ref
            value={`ARGOS_API_BASE_URL=${location.origin}/v2`}
            label="Argos address"
            className={styles.code}
          />
        </div>
      </div>
    )
  }

  if (!hasWorkspace) {
    return canCreateWorkspace ? (
      <EmptyState
        icon={<BuildingIcon />}
        title="Create a workspace"
        action={
          <Button variant="primary" onClick={() => setNewWorkspaceOpen(true)}>
            New workspace
          </Button>
        }
      >
        A workspace holds your teams and members.
      </EmptyState>
    ) : (
      <EmptyState icon={<BuildingIcon />} title="No workspace yet">
        Ask an owner to add you to one.
      </EmptyState>
    )
  }

  return (
    <EmptyState icon={<LayersIcon />} title="No teams yet">
      Ask an owner or admin to create one.
    </EmptyState>
  )
}

export namespace TeamsEmpty {
  export interface Props {
    canCreateTeam: boolean
    canCreateWorkspace: boolean
    /** Whether the person belongs to a workspace at all. */
    hasWorkspace: boolean
  }
}
