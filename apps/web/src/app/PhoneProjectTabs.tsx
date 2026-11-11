import { TabList } from '@circi/ui'
import { useNavigate, useParams, useRouterState } from '@tanstack/react-router'

import { useSidebarModel } from '#features/sidebar/api.ts'
import { usePhone } from '#lib/use-phone.ts'

import { type ProjectPage, projectPageOf } from './shell-model.ts'

import styles from './PhoneProjectTabs.module.css'

const PAGE_LABEL: Record<ProjectPage, string> = {
  builds: 'Builds',
  triage: 'Triage',
  baselines: 'Baselines',
  sites: 'Sites',
}

/**
 * On a phone, the tabs of a project's pages under the page header: Builds, Triage, Baselines and,
 * only when the project has sites, Sites (the sidebar's rule). The tabs are `TabList` (Base UI
 * Tabs) used as a navigation strip: choosing one goes to that page. Desktop shows none: the
 * sidebar's sub-items are its navigation. `PageHeading` renders this under every page header.
 */
export function PhoneProjectTabs() {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const phone = usePhone()
  const current = projectPageOf(pathname)
  if (!phone || !current) return null
  return <Tabs current={current} />
}

function Tabs({ current }: { current: ProjectPage }) {
  const { workspace, project } = useParams({ strict: false })
  const navigate = useNavigate()
  const { data: model } = useSidebarModel(workspace)
  if (!workspace || !project) return null
  const siteCount = model?.projects.find((t) => t.slug === project)?.siteCount ?? 0
  const pages: ProjectPage[] = [
    'builds',
    'triage',
    'baselines',
    ...(siteCount > 0 ? (['sites'] as const) : []),
  ]
  const go = (page: ProjectPage) => {
    const params = { workspace, project }
    if (page === 'builds') void navigate({ to: '/$workspace/$project', params })
    else if (page === 'triage') void navigate({ to: '/$workspace/$project/triage', params })
    else if (page === 'baselines') void navigate({ to: '/$workspace/$project/baselines', params })
    else void navigate({ to: '/$workspace/$project/sites', params })
  }
  return (
    <div className={styles.root}>
      <TabList
        label="Project pages"
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
