import type { Baseline, Flaky } from '@circi/api'
import { flakyReasonText } from '@circi/core'
import {
  ContextMenu,
  EmptyState,
  ImagesIcon,
  ListGroup,
  ListRow,
  NoResults,
  StatusIcon,
  Text,
} from '@circi/ui'
import { useQuery } from '@tanstack/react-query'
import { useParams, useRouter } from '@tanstack/react-router'
import { useState } from 'react'

import { flakyQuery } from '#features/projects/api/index.ts'
import { useCrumbNames } from '#features/projects/crumb-names.ts'
import { useDocumentTitle } from '#lib/document-title.ts'
import { useFindParam } from '#lib/find.ts'
import { FindField } from '#lib/FindField.tsx'
import { crumbsFor, PageHeading } from '#lib/PageHeading.tsx'
import { QueryBoundary } from '#lib/QueryBoundary.tsx'
import { Age } from '#lib/RelativeTime.tsx'
import { copyText, copyLinkItem, menuEntries, openInNewTabItem } from '#lib/row-menu.ts'
import { useClientLink } from '#lib/use-client-link.ts'
import { useListNavigation } from '#lib/use-list-navigation.ts'

import {
  baselineId,
  baselinesQuery,
  filterBaselines,
  flattenGroups,
  groupBaselines,
} from './api.ts'
import { baselineLink } from './links.ts'
import { ROUTE } from './routes.ts'

import styles from './BaselinesPage.module.css'

export function BaselinesPage() {
  const { workspace, project } = useParams({ from: ROUTE })
  const names = useCrumbNames(workspace, project)
  useDocumentTitle('Baselines', project)
  const clientLink = useClientLink()
  const router = useRouter()
  const query = useQuery(baselinesQuery(workspace, project))
  const { data } = query
  const flaky = useQuery(flakyQuery(workspace, project))
  const flakyOf = new Map((flaky.data?.flaky ?? []).map((f) => [f.name, f.reason]))
  const [filter, setFilter] = useFindParam()
  const [selectedId, setSelectedId] = useState<string>()

  const openBuild = (number: number) =>
    void router.navigate({
      to: '/$workspace/$project/builds/$number',
      params: { workspace, project, number: String(number) },
    })
  /** A row's right-click menu: what its address, its build chip and its flaky chip open. */
  const rowMenu = (item: Baseline.Item, href: string) =>
    menuEntries([
      {
        label: 'Open',
        onSelect: () => void router.navigate(baselineLink(workspace, project, item.name)),
      },
      { label: `Open build #${item.buildNumber}`, onSelect: () => openBuild(item.buildNumber) },
      flakyOf.has(item.name) && {
        label: 'Open in Triage',
        onSelect: () =>
          void router.navigate({ href: triageItemHref(workspace, project, item.name) }),
      },
      openInNewTabItem(href),
      copyLinkItem(href),
      { label: 'Copy name', onSelect: () => void copyText(item.name, 'Name') },
    ])

  const all = data?.baselines ?? []
  const groups = groupBaselines(filterBaselines(all, filter))
  const items = flattenGroups(groups)

  const { listRef, rowProps } = useListNavigation({
    items,
    getId: baselineId,
    selectedId,
    onSelect: (i: Baseline.Item) => setSelectedId(baselineId(i)),
  })

  return (
    <>
      <PageHeading
        crumbs={crumbsFor(names)}
        title="Baselines"
        after={
          data && all.length > 0 ? (
            <Text variant="small" tone="tertiary" role="status">
              {items.length} on {data.project.defaultBranch}
            </Text>
          ) : null
        }
        find={
          data && all.length > 0 ? (
            <FindField noun="baselines" value={filter} onChange={setFilter} />
          ) : null
        }
      />
      <div className={styles.page}>
        <QueryBoundary
          query={query}
          announce="Loading baselines"
          notFound="Project not found"
          rows={4}
        >
          {(loaded) =>
            all.length === 0 ? (
              <div className={styles.empty}>
                <EmptyState icon={<ImagesIcon />} title="No baselines yet">
                  Once a build of {loaded.project.defaultBranch} finishes, its screenshots become
                  the baselines.
                </EmptyState>
              </div>
            ) : (
              <>
                {items.length === 0 ? (
                  <div className={styles.empty}>
                    <NoResults noun="baseline" query={filter} onClear={() => setFilter('')} />
                  </div>
                ) : (
                  <div className={styles.groups} ref={listRef}>
                    {groups.map((group) => {
                      const title = group.prefix ?? 'Ungrouped'
                      const id = `baselines-${group.prefix ?? '(ungrouped)'}`
                      return (
                        <section key={id} aria-labelledby={id}>
                          <ListGroup id={id} label={title} count={group.items.length} />
                          <ul className={styles.list}>
                            {group.items.map((item) => (
                              <li key={baselineId(item)} {...rowProps(baselineId(item))}>
                                <ContextMenu
                                  items={rowMenu(
                                    item,
                                    clientLink(baselineLink(workspace, project, item.name)).href,
                                  )}
                                >
                                  <ListRow
                                    selected={baselineId(item) === selectedId}
                                    {...clientLink(baselineLink(workspace, project, item.name))}
                                    leading={
                                      <StatusIcon
                                        status="approved"
                                        label={`Baseline on ${loaded.project.defaultBranch}`}
                                      />
                                    }
                                    title={
                                      <>
                                        {item.name}
                                        {item.buildName === 'default' ? null : (
                                          <span className={styles.buildName}>
                                            {' '}
                                            · {item.buildName}
                                          </span>
                                        )}
                                      </>
                                    }
                                    subtitle={`Build #${item.buildNumber}`}
                                    action={{
                                      label: `Open build #${item.buildNumber} ↗`,
                                      onAction: () =>
                                        void router.navigate({
                                          to: '/$workspace/$project/builds/$number',
                                          params: {
                                            workspace,
                                            project,
                                            number: String(item.buildNumber),
                                          },
                                        }),
                                    }}
                                    trailing={
                                      <>
                                        {flakyOf.has(item.name) ? (
                                          <FlakyChip
                                            reason={flakyOf.get(item.name)!}
                                            onOpen={() =>
                                              void router.navigate({
                                                href: triageItemHref(workspace, project, item.name),
                                              })
                                            }
                                          />
                                        ) : null}
                                        <span className={styles.age}>
                                          <Age iso={item.approvedAt} />
                                        </span>
                                      </>
                                    }
                                  />
                                </ContextMenu>
                              </li>
                            ))}
                          </ul>
                        </section>
                      )
                    })}
                  </div>
                )}
              </>
            )
          }
        </QueryBoundary>
      </div>
    </>
  )
}

/** The Triage page with this screenshot's flaky item selected. */
const triageItemHref = (workspace: string, project: string, name: string) =>
  `/${encodeURIComponent(workspace)}/${encodeURIComponent(project)}/triage?item=${encodeURIComponent(`flaky:${name}`)}`

/**
 * A flaky screenshot's chip: the flaky glyph and why it was marked. It opens the screenshot's item
 * in Triage. Inside the row's link it can't be a link of its own, so like the row's action chip it
 * takes the click (the item is also reachable from Triage itself).
 */
function FlakyChip({ reason, onOpen }: { reason: Flaky.Reason; onOpen: () => void }) {
  const text = flakyReasonText(reason)
  return (
    <span
      className={styles.flakyChip}
      title={`Flaky: ${text}. Open in Triage`}
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
        onOpen()
      }}
    >
      <StatusIcon status="flaky" size={12} decorative />
      <span className={styles.flakyText}>{text}</span>
    </span>
  )
}
