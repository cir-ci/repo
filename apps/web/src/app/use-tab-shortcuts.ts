import { useShortcutHandlers } from '#lib/shortcuts.ts'
import { useTabStore } from '#lib/stores/tab-store.ts'

import { hrefFrom, isAppLink } from './tab-sync.ts'

/** The link a focused list row opens: the row's own `<a>`, or the first one inside it. */
function rowLink(event: KeyboardEvent): HTMLAnchorElement | undefined {
  const where = event.target instanceof Element ? event.target : document.activeElement
  const row = where?.closest('[data-row-id]')
  if (!row) return undefined
  const link = row.matches('a[href]') ? row : row.querySelector('a[href]')
  return link instanceof HTMLAnchorElement && isAppLink(link) ? link : undefined
}

const tabs = () => useTabStore.getState()

/**
 * The tab shortcuts (⌥T, ⌥W, ⌘⇧T, ⌥1 to ⌥9, ⌥←/→, ⌥P, ⌥⇧←/→ and ⌘↵ on a row). The keys exist only
 * in the installed app (`installed` in `SHORTCUTS`), so in a browser tab none of this is reached.
 */
export function useTabShortcuts(): void {
  useShortcutHandlers({
    newTab: () => void tabs().openNew(),
    closeTab: () => tabs().closeActive(),
    restoreTab: () => tabs().restore(),
    goToTab: ({ number }) => tabs().goTo(number),
    stepTab: ({ delta }) => tabs().step(delta),
    pinTab: () => tabs().togglePin(tabs().activeId),
    moveTab: ({ delta }) => tabs().move(tabs().activeId, delta),
    // ⌘↵ on a row opens it in a new tab; anywhere else it keeps its meaning (sending a comment).
    openInTab: (_action, event) => {
      const link = rowLink(event)
      if (!link) return false
      tabs().open(hrefFrom(link.href), { background: true })
      return undefined
    },
  })
}
