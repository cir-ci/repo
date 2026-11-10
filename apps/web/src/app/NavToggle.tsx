import { IconButton, Kbd, PanelLeftCloseIcon, PanelLeftOpenIcon, Tooltip } from '@circi/ui'
import { useRouterState } from '@tanstack/react-router'

import { type NavPaneId } from '#lib/panes.ts'
import { usePaneStore } from '#lib/stores/pane-store.ts'

import { currentSection, isSettingsSection } from './shell-model.ts'

import styles from './NavToggle.module.css'

/** The navigation the current page shows: Settings has its own, the rest share the main sidebar. */
export function useNavPaneId(): NavPaneId {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  return isSettingsSection(currentSection(pathname)) ? 'settings-nav' : 'sidebar'
}

/**
 * Collapses or restores the current navigation (the sidebar or Settings'). Focus follows the
 * control that takes over: the page header's "Show sidebar" after hiding, the navigation's own
 * "Hide sidebar" after showing.
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

/** In the navigation's header: hides it. */
export function HideNavButton() {
  const { id, collapse } = useNavPane()
  return (
    <Tooltip
      content={
        <>
          Hide {noun(id)} <Kbd>⌘\</Kbd>
        </>
      }
      side="bottom"
    >
      <IconButton
        label={id === 'sidebar' ? 'Hide sidebar' : 'Hide settings navigation'}
        aria-keyshortcuts="Meta+\"
        data-hide-nav=""
        className={styles.hide}
        onClick={collapse}
      >
        <PanelLeftCloseIcon size={16} />
      </IconButton>
    </Tooltip>
  )
}

/** At the left of the page header while the navigation is collapsed: brings it back. */
export function ShowNavButton() {
  const { id, collapsed, expand } = useNavPane()
  if (!collapsed) return null
  return (
    <Tooltip
      content={
        <>
          Show {noun(id)} <Kbd>⌘\</Kbd>
        </>
      }
      side="bottom"
    >
      <IconButton
        label={id === 'sidebar' ? 'Show sidebar' : 'Show settings navigation'}
        aria-keyshortcuts="Meta+\"
        data-show-nav=""
        className={styles.show}
        onClick={expand}
      >
        <PanelLeftOpenIcon size={16} />
      </IconButton>
    </Tooltip>
  )
}
