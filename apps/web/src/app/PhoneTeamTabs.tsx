import { TabList } from '@circi/ui'
import { useNavigate, useParams, useRouterState } from '@tanstack/react-router'

import { useSidebarModel } from '#features/sidebar/api.ts'
import { usePhone } from '#lib/use-phone.ts'

import { type TeamPage, teamPageOf } from './shell-model.ts'

import styles from './PhoneTeamTabs.module.css'

const PAGE_LABEL: Record<TeamPage, string> = {
  builds: 'Builds',
  triage: 'Triage',
  baselines: 'Baselines',
  sites: 'Sites',
}

/**
 * On a phone, the tabs of a team's pages under the page header: Builds, Triage, Baselines and,
 * only when the team has sites, Sites (the sidebar's rule). The tabs are `TabList` (Base UI
 * Tabs) used as a navigation strip: choosing one goes to that page. Desktop shows none: the
 * sidebar's sub-items are its navigation. `PageHeading` renders this under every page header.
 */
export function PhoneTeamTabs() {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const phone = usePhone()
  const current = teamPageOf(pathname)
  if (!phone || !current) return null
  return <Tabs current={current} />
}

function Tabs({ current }: { current: TeamPage }) {
  const { workspace, team } = useParams({ strict: false })
  const navigate = useNavigate()
  const { data: model } = useSidebarModel(workspace)
  if (!workspace || !team) return null
  const siteCount = model?.teams.find((t) => t.slug === team)?.siteCount ?? 0
  const pages: TeamPage[] = [
    'builds',
    'triage',
    'baselines',
    ...(siteCount > 0 ? (['sites'] as const) : []),
  ]
  const go = (page: TeamPage) => {
    const params = { workspace, team }
    if (page === 'builds') void navigate({ to: '/$workspace/$team', params })
    else if (page === 'triage') void navigate({ to: '/$workspace/$team/triage', params })
    else if (page === 'baselines') void navigate({ to: '/$workspace/$team/baselines', params })
    else void navigate({ to: '/$workspace/$team/sites', params })
  }
  return (
    <div className={styles.root}>
      <TabList
        label="Team pages"
        tabs={pages.map((page) => ({ value: page, label: PAGE_LABEL[page] }))}
        value={current}
        onChange={go}
        panelClassName={styles.panel}
      >
        {null}
      </TabList>
    </div>
  )
}
