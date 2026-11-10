import type { Team } from '@circi/api'
import { Avatar } from '@circi/ui'

import styles from './AvatarStack.module.css'

/** How many avatars a stack draws; the count beside it says the rest. */
const STACK_LIMIT = 5

/** "1 member", "3 members". */
export const memberCountLabel = (n: number) => `${n} ${n === 1 ? 'member' : 'members'}`

/** "1 team", "3 teams". */
export const teamCountLabel = (n: number) => `${n} ${n === 1 ? 'team' : 'teams'}`

/** Overlapping avatars followed by a count ("3 members"). The avatars are decoration; the count says it. */
function Stack({ count, children }: { count: string; children: React.ReactNode }) {
  return (
    <span className={styles.root}>
      <span className={styles.stack} aria-hidden="true">
        {children}
      </span>
      <span className={styles.count}>{count}</span>
    </span>
  )
}

/** A team's people: user avatars, then "N members". */
export function MemberStack({ count, people }: MemberStack.Props) {
  return (
    <Stack count={memberCountLabel(count)}>
      {people.slice(0, STACK_LIMIT).map((p) => (
        <Avatar key={p.id} type="user" id={p.id} name={p.name} image={p.image} size={20} />
      ))}
    </Stack>
  )
}

/** A person's teams: marble avatars, then "N teams". */
export function TeamStack({ teams }: TeamStack.Props) {
  return (
    <Stack count={teamCountLabel(teams.length)}>
      {teams.slice(0, STACK_LIMIT).map((t) => (
        <Avatar
          key={t.slug}
          type="team"
          slug={t.slug}
          name={t.name}
          color={t.color}
          icon={t.icon}
          size={20}
        />
      ))}
    </Stack>
  )
}

export namespace MemberStack {
  export interface Props {
    /** The team's member count (the people shown may be fewer). */
    count: number
    people: ReadonlyArray<Team.MemberPreview>
  }
}

export namespace TeamStack {
  export interface Props {
    teams: ReadonlyArray<{ slug: string; name: string; color: Team.Color; icon: string | null }>
  }
}
