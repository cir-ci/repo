import { Avatar, PinIcon, Sheet, visuallyHidden } from '@circi/ui'
import { useNavigate, useRouterState } from '@tanstack/react-router'
import { useEffect } from 'react'

import { useYourTeams } from '#features/sidebar/use-your-teams.ts'
import { useOverlayStore } from '#lib/stores/overlay-store.ts'

import { SheetRow } from './PhoneRow.tsx'
import { countOrUndefined, teamSections } from './shell-model.ts'

import styles from './PhoneMore.module.css'

/**
 * The phone's Teams sheet (the Teams tab of the bottom bar): your teams in every workspace, pinned
 * first, then the rest (grouped by workspace when there are several), each with its triage count.
 * Choosing a team opens its page; "All teams" opens the Teams page. Rows are the More sheet's.
 */
export function PhoneTeams() {
  const navigate = useNavigate()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const open = useOverlayStore((s) => s.teamsOpen)
  const setOpen = useOverlayStore((s) => s.setTeamsOpen)
  const sections = teamSections(useYourTeams())

  // Any page change (a team chosen, a link) closes the sheet.
  useEffect(() => {
    if (pathname) setOpen(false)
  }, [pathname, setOpen])

  const go = (href: string) => {
    setOpen(false)
    void navigate({ href })
  }

  return (
    <Sheet open={open} onOpenChange={setOpen} title="Teams" size="tall">
      <nav aria-label="Teams" className={styles.list}>
        {sections.map((section) => (
          <div
            key={section.key}
            {...(section.label ? { role: 'group', 'aria-label': section.label } : {})}
          >
            {section.label ? <div className={styles.heading}>{section.label}</div> : null}
            {section.teams.map((t) => {
              const triage = countOrUndefined(t.triage)
              return (
                <SheetRow
                  onGo={go}
                  key={`${t.workspace.slug}/${t.slug}`}
                  href={`/${encodeURIComponent(t.workspace.slug)}/${encodeURIComponent(t.slug)}`}
                  icon={
                    <Avatar
                      type="team"
                      aria-hidden
                      slug={t.slug}
                      name={t.name}
                      color={t.color}
                      icon={t.icon}
                      size={20}
                    />
                  }
                  trailing={
                    <>
                      {section.showWorkspace ? (
                        <span className={styles.count}>{t.workspace.name}</span>
                      ) : null}
                      {t.pinned && !section.showWorkspace ? (
                        <PinIcon size={12} aria-hidden="true" />
                      ) : null}
                      {triage === undefined ? null : (
                        <span className={styles.count}>
                          {triage}
                          <span style={visuallyHidden}>
                            {triage === 1 ? ' item to triage' : ' items to triage'}
                          </span>
                        </span>
                      )}
                    </>
                  }
                >
                  {t.name}
                </SheetRow>
              )
            })}
          </div>
        ))}
        <div className={styles.rule} role="presentation" />
        <SheetRow onGo={go} href="/" more>
          All teams
        </SheetRow>
      </nav>
    </Sheet>
  )
}
