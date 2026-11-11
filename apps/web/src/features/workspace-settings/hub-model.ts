/** The pages of a workspace's settings the hub lists. */
export type WorkspaceHubKey =
  | 'general'
  | 'members'
  | 'projects'
  | 'sign-in'
  | 'integrations'
  | 'storage'

/**
 * What the hub knows about a workspace without opening its pages; `undefined` while a number loads
 * or when it isn't cheap to know (everything but the counts the instance list carries is read
 * only for owners and admins).
 */
export interface WorkspaceHubFacts {
  /** The viewer belongs to the workspace: only members may open its pages. */
  member: boolean
  /** Owners and admins see every page; members see Members and Projects. */
  canManage: boolean | undefined
  slug: string
  memberCount: number
  projectCount: number
  /** The workspace's storage, already formatted ("1.2 GB"). */
  storage: string
  /** How many sign-in methods are on. */
  signInMethods: number | undefined
  integrationCount: number | undefined
}

export interface WorkspaceHubRow {
  key: WorkspaceHubKey
  label: string
  detail: string
  /** The short summary on the right; undefined until known. */
  value: string | undefined
}

export interface WorkspaceHubGroup {
  title: string
  rows: WorkspaceHubRow[]
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

const countOrNone = (n: number | undefined, one: string, many: string) =>
  n === undefined ? undefined : n === 0 ? 'None' : plural(n, one, many)

const row = (
  key: WorkspaceHubKey,
  label: string,
  detail: string,
  value?: string,
): WorkspaceHubRow => ({ key, label, detail, value })

/** "N members · N projects", under the workspace's name. */
export function hubSubtitle(memberCount: number, projectCount: number): string {
  return `${plural(memberCount, 'member', 'members')} · ${plural(projectCount, 'project', 'projects')}`
}

/**
 * The hub's groups and rows in order, for the pages the viewer can open. Someone outside the
 * workspace gets none (the page says so); members get Members and Projects; empty groups are left out.
 */
export function workspaceHubGroups(facts: WorkspaceHubFacts): WorkspaceHubGroup[] {
  if (!facts.member) return []
  const manage = facts.canManage === true
  const groups: WorkspaceHubGroup[] = [
    {
      title: 'Workspace',
      rows: [
        ...(manage
          ? [
              row(
                'general',
                'General',
                'Name, picture, URL slug, merge and triage defaults',
                facts.slug,
              ),
            ]
          : []),
        row(
          'members',
          'Members',
          'Who is in the workspace and their roles',
          plural(facts.memberCount, 'member', 'members'),
        ),
        row(
          'projects',
          'Projects',
          'Every project in the workspace',
          countOrNone(facts.projectCount, 'project', 'projects'),
        ),
      ],
    },
    {
      title: 'Access',
      rows: manage
        ? [
            row(
              'sign-in',
              'Sign-in and domains',
              'How people sign in, and which email domains may join',
              countOrNone(facts.signInMethods, 'method', 'methods'),
            ),
          ]
        : [],
    },
    {
      title: 'Connections',
      rows: manage
        ? [
            row(
              'integrations',
              'Integrations',
              'Git hosts and other tools the workspace connects',
              countOrNone(facts.integrationCount, 'integration', 'integrations'),
            ),
          ]
        : [],
    },
    {
      title: 'Data',
      rows: manage
        ? [
            row(
              'storage',
              'Storage and retention',
              'What builds and sites take up, and how long they are kept',
              facts.storage,
            ),
          ]
        : [],
    },
  ]
  return groups.filter((g) => g.rows.length > 0)
}
