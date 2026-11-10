import { IconButton, Kbd, PanelLeftCloseIcon, PanelLeftOpenIcon, Tooltip } from '@circi/ui'
import { useRouterState } from '@tanstack/react-router'

import { type NavPaneId } from '#lib/panes.ts'
import { usePaneStore } from '#lib/stores/pane-store.ts'
import { usePhone } from '#lib/use-phone.ts'

import { currentSection, isSettingsSection } from './shell-model.ts'

/** The navigation the current page shows: Settings has its own, the rest share the main sidebar. */
export function useNavPaneId(): NavPaneId {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  return isSettingsSection(currentSection(pathname)) ? 'settings-nav' : 'sidebar'
}

/**
 * Collapses or restores the current navigation (the sidebar or Settings'). Focus stays on the page
 * header's toggle, which turns from "Hide sidebar" into "Show sidebar" and back.
 */
export function useNavPane() {
  const id = useNavPaneId()
  const collapsed = usePaneStore((s) => s.collapsed[id])
  const setCollapsed = usePaneStore((s) => s.setCollapsed)
  const set = (next: boolean) => {
    setCollapsed(id, next)
    requestAnimationFrame(() => {
      document.querySelector<HTMLElement>(next ? '[data-show-nav]' : '[data-hide-nav]')?.focus()
    })
  }
  return {
    id,
    collapsed,
    collapse: () => set(true),
    expand: () => set(false),
    toggle: () => set(!collapsed),
  }
}

const noun = (id: NavPaneId) => (id === 'sidebar' ? 'sidebar' : 'settings navigation')

/**
 * At the left of the page header, before the crumbs: hides the navigation (the sidebar or
 * Settings'), and once it is hidden, brings it back from the same place. Desktop only: a phone has
 * no sidebar.
 */
export function NavToggleButton() {
  const { id, collapsed, collapse, expand } = useNavPane()
  if (usePhone()) return null
  const verb = collapsed ? 'Show' : 'Hide'
  return (
    <Tooltip
      content={
        <>
          {verb} {noun(id)} <Kbd>⌘\</Kbd>
        </>
      }
      side="bottom"
    >
      <IconButton
        label={`${verb} ${id === 'sidebar' ? 'sidebar' : 'settings navigation'}`}
        aria-keyshortcuts="Meta+\"
        {...(collapsed ? { 'data-show-nav': '' } : { 'data-hide-nav': '' })}
        onClick={collapsed ? expand : collapse}
      >
        {collapsed ? <PanelLeftOpenIcon size={16} /> : <PanelLeftCloseIcon size={16} />}
      </IconButton>
    </Tooltip>
  )
}
