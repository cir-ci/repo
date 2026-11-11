/** The pages of the Instance the hub lists. */
export type InstanceHubKey = 'accounts' | 'workspaces' | 'settings' | 'health'

/**
 * What the hub knows without opening the pages; `undefined` while it loads. The doctor's checks
 * ask other hosts, so Health is listed without a summary.
 */
export interface InstanceHubFacts {
  accountCount: number | undefined
  workspaceCount: number | undefined
  /** The dashboard's public URL, from Instance settings. */
  publicUrl: string | undefined
}

export interface InstanceHubRow {
  key: InstanceHubKey
  label: string
  detail: string
  value: string | undefined
}

export interface InstanceHubGroup {
  title: string
  rows: InstanceHubRow[]
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

const count = (n: number | undefined, one: string, many: string) =>
  n === undefined ? undefined : plural(n, one, many)

/** The address without its scheme ("ci.acme.io"); the text itself when it isn't a URL. */
export function hostOfUrl(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

/** The hub's name and subtitle: the instance has no name of its own, so it is "Instance" at its host. */
export function instanceHubTitle(publicUrl: string | undefined): {
  name: string
  subtitle: string | undefined
} {
  return { name: 'Instance', subtitle: publicUrl ? hostOfUrl(publicUrl) : undefined }
}

/**
 * Whether the sidebar's Instance entry is the selected one: the hub and every `/instance` page
 * below it, except the workspaces list, which belongs to the Workspaces section.
 */
export function onInstancePage(pathname: string): boolean {
  if (pathname !== '/instance' && !pathname.startsWith('/instance/')) return false
  return pathname !== '/instance/workspaces' && !pathname.startsWith('/instance/workspaces/')
}

/** The hub's groups and rows, in order. */
export function instanceHubGroups(facts: InstanceHubFacts): InstanceHubGroup[] {
  return [
    {
      title: 'People',
      rows: [
        {
          key: 'accounts',
          label: 'Accounts',
          detail: 'Everyone who can sign in, and who runs the instance',
          value: count(facts.accountCount, 'account', 'accounts'),
        },
      ],
    },
    {
      title: 'Workspaces',
      rows: [
        {
          key: 'workspaces',
          label: 'All workspaces',
          detail: 'Every workspace of the instance, new and deleted ones',
          value: count(facts.workspaceCount, 'workspace', 'workspaces'),
        },
      ],
    },
    {
      title: 'Server',
      rows: [
        {
          key: 'settings',
          label: 'Instance settings',
          detail: 'Address, sign-in methods, mail and who can create workspaces',
          value: facts.publicUrl ? hostOfUrl(facts.publicUrl) : undefined,
        },
        {
          key: 'health',
          label: 'Health',
          detail: 'What CirCI runs on, its addresses and its background jobs',
          value: undefined,
        },
      ],
    },
  ]
}
