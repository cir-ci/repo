import type { Project } from '@circi/api'
import { Avatar, AvatarStack } from '@circi/ui'

import { ProjectAvatars } from '#lib/ProjectAvatars.tsx'

import styles from './AvatarStack.module.css'

/** How many avatars a stack draws; the count beside it says the rest. */
const STACK_LIMIT = 5

/** "1 member", "3 members". */
export const memberCountLabel = (n: number) => `${n} ${n === 1 ? 'member' : 'members'}`

/** "1 project", "3 projects". */
export const projectCountLabel = (n: number) => `${n} ${n === 1 ? 'project' : 'projects'}`

/** A stack of avatars followed by a count ("3 members"). The avatars are decoration; the count says it. */
function Stack({ count, children }: { count: string; children: React.ReactNode }) {
  return (
    <span className={styles.root}>
      <AvatarStack aria-hidden="true">{children}</AvatarStack>
      <span className={styles.count}>{count}</span>
    </span>
  )
}

/** A project's people: user avatars, then "N members". */
export function MemberStack({ count, people }: MemberStack.Props) {
  return (
    <Stack count={memberCountLabel(count)}>
      {people.slice(0, STACK_LIMIT).map((p) => (
        <Avatar key={p.id} type="user" id={p.id} name={p.name} image={p.image} size={20} />
      ))}
    </Stack>
  )
}

/** A person's projects: the project avatars, then "N projects". */
export function Projectstack({ projects }: Projectstack.Props) {
  return (
    <span className={styles.root}>
      <ProjectAvatars aria-hidden="true" projects={projects} limit={STACK_LIMIT} overflow={false} />
      <span className={styles.count}>{projectCountLabel(projects.length)}</span>
    </span>
  )
}

export namespace MemberStack {
  export interface Props {
    /** The project's member count (the people shown may be fewer). */
    count: number
    people: ReadonlyArray<Project.MemberPreview>
  }
}

export namespace Projectstack {
  export interface Props {
    projects: ReadonlyArray<{
      slug: string
      name: string
      color: Project.Color
      icon: string | null
    }>
  }
}
