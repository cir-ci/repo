import type { ProjectsettingsKey } from '#app/shell-model.ts'
import { memberCountLabel } from '#features/projects/AvatarStack.tsx'

/** What the hub knows about a project without opening its pages; `undefined` while a number loads. */
export interface HubFacts {
  /** Owners and admins see every page; members see Members and Ignore regions. */
  canManage: boolean
  memberCount: number | undefined
  /** The project's review rules. */
  ruleCount: number | undefined
  regionCount: number | undefined
  webhookCount: number | undefined
  siteCount: number | undefined
}

export interface HubRow {
  key: ProjectsettingsKey
  label: string
  detail: string
  /** The short summary on the right; undefined until known. */
  value: string | undefined
}

export interface HubGroup {
  title: string
  rows: HubRow[]
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** "None" for zero, otherwise the count with its noun. */
const countOrNone = (n: number | undefined, one: string, many: string) =>
  n === undefined ? undefined : n === 0 ? 'None' : plural(n, one, many)

const row = (key: ProjectsettingsKey, label: string, detail: string, value?: string): HubRow => ({
  key,
  label,
  detail,
  value,
})

/** The hub's groups and rows in order, for the pages the person has. Empty groups are left out. */
export function hubGroups(facts: HubFacts): HubGroup[] {
  const { canManage } = facts
  const groups: HubGroup[] = [
    {
      title: 'Project',
      rows: [
        ...(canManage
          ? [row('general', 'General', 'Name, icon, default branch and merge gate')]
          : []),
        row(
          'members',
          'Members',
          'Who is in the project and their roles',
          facts.memberCount === undefined ? undefined : memberCountLabel(facts.memberCount),
        ),
        ...(canManage ? [row('token', 'CI token', 'What CI uses to upload screenshots')] : []),
      ],
    },
    {
      title: 'Reviews',
      rows: [
        ...(canManage
          ? [
              row(
                'reviews',
                'Reviews and triage',
                'Who reviews what, how fast, and who is on triage',
                facts.ruleCount === undefined
                  ? undefined
                  : facts.ruleCount === 0
                    ? 'No rules'
                    : plural(facts.ruleCount, 'rule', 'rules'),
              ),
            ]
          : []),
        row(
          'ignore-regions',
          'Ignore regions',
          'Areas of a screenshot left out of comparisons',
          countOrNone(facts.regionCount, 'region', 'regions'),
        ),
      ],
    },
    {
      title: 'Connections',
      rows: canManage
        ? [
            row(
              'webhooks',
              'Webhooks',
              'Where build and review events are sent',
              countOrNone(facts.webhookCount, 'webhook', 'webhooks'),
            ),
            row(
              'sites',
              'Sites',
              'Static sites the project hosts',
              countOrNone(facts.siteCount, 'site', 'sites'),
            ),
          ]
        : [],
    },
  ]
  return groups.filter((g) => g.rows.length > 0)
}
