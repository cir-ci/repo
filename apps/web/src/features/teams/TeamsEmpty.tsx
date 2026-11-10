import { Button, EmptyState, FolderOpenIcon, PlusIcon, Ref, Text } from '@circi/ui'

import { useOverlayStore } from '#lib/stores/overlay-store.ts'

import styles from './TeamsEmpty.module.css'

/**
 * The Teams page with no team yet (the canvas's "Teams, none yet" board): create the first team,
 * and, for people coming from Argos, the one variable that points the Argos SDK at this server.
 * Without the right to create teams it says what to do instead.
 */
export function TeamsEmpty({ canCreateTeam, canCreateWorkspace }: TeamsEmpty.Props) {
  const setNewTeamOpen = useOverlayStore((s) => s.setNewTeamOpen)
  const setNewWorkspaceOpen = useOverlayStore((s) => s.setNewWorkspaceOpen)

  if (!canCreateTeam) {
    return (
      <EmptyState
        icon={<FolderOpenIcon size={32} />}
        title="Create your first team"
        action={
          canCreateWorkspace ? (
            <Button variant="primary" onClick={() => setNewWorkspaceOpen(true)}>
              New workspace
            </Button>
          ) : undefined
        }
      >
        {canCreateWorkspace
          ? 'Create a workspace first, then add a team to it.'
          : "You aren't an owner or admin of any workspace yet. Ask one to add you, or to create a team."}
      </EmptyState>
    )
  }

  return (
    <section className={styles.root} aria-labelledby="teams-empty-title">
      <span className={styles.mark} aria-hidden="true">
        <FolderOpenIcon size={20} />
      </span>
      <h2 id="teams-empty-title" className={styles.title}>
        Create your first team
      </h2>
      <Text as="p" tone="secondary">
        A team is one app or component library whose screenshots your CI uploads. Each gets its own
        baselines, reviews and CI token.
      </Text>
      <Button variant="primary" onClick={() => setNewTeamOpen(true)}>
        <PlusIcon size={14} />
        New team
      </Button>
      <div className={styles.argos}>
        <Text as="p" tone="secondary">
          Already uploading with Argos? Point the Argos SDK at this server:
        </Text>
        <Ref
          value={`ARGOS_API_BASE_URL=${location.origin}/v2`}
          label="Argos address"
          className={styles.code}
        />
        <Text as="p" variant="small" tone="tertiary">
          Its token is the team's CI token, so create the team first.
        </Text>
      </div>
    </section>
  )
}

export namespace TeamsEmpty {
  export interface Props {
    canCreateTeam: boolean
    canCreateWorkspace: boolean
  }
}
