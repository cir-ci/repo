import type { Menu } from '@circi/ui'

import { clipboard } from '#lib/clipboard.ts'
import { isInstalled } from '#lib/document-title.ts'
import type { SnoozeChoice } from '#lib/snooze.ts'
import { useTabStore } from '#lib/stores/tab-store.ts'
import { toast } from '#lib/toast.ts'
import { isPhone } from '#lib/use-phone.ts'

/** Items a row's right-click menu shares: the ones about the row's address. */

function absolute(href: string): string {
  return new URL(href, window.location.origin).href
}

/** Copies `href` (a path or a full address) as a full address and says so in a toast. */
export async function copyText(text: string, what: string): Promise<void> {
  try {
    await clipboard.write(text)
    toast(`${what} copied`)
  } catch {
    toast.error(`Couldn't copy the ${what.toLowerCase()}`)
  }
}

export function copyLinkItem(href: string): Menu.Item {
  return { label: 'Copy link', onSelect: () => void copyText(absolute(href), 'Link') }
}

/**
 * Open in new tab: a browser tab in a browser; a tab of the app's own in the installed app (where
 * `window.open` would make a second app window). It opens behind the current one, as a browser
 * does; on a phone, with no strip to show it, a toast says so and can take it back.
 */
export function openInNewTab(href: string): void {
  if (!isInstalled()) {
    window.open(absolute(href), '_blank', 'noopener')
    return
  }
  const tabs = useTabStore.getState()
  const path = new URL(href, window.location.origin)
  const id = tabs.open(path.pathname + path.search + path.hash, { background: true })
  if (isPhone()) toast.undoable('Opened in a new tab', () => Promise.resolve(tabs.close(id)))
}

export function openInNewTabItem(href: string): Menu.Item {
  return { label: 'Open in new tab', onSelect: () => openInNewTab(href) }
}

/** A list of entries with the ones that don't apply (`false`, `null`) left out and no separator at an end or twice in a row. */
export function menuEntries(
  entries: ReadonlyArray<Menu.Entry | false | null | undefined>,
): Menu.Entry[] {
  const out: Menu.Entry[] = []
  for (const entry of entries) {
    if (!entry) continue
    if (
      entry.type === 'separator' &&
      (out.length === 0 || out[out.length - 1]?.type === 'separator')
    )
      continue
    out.push(entry)
  }
  if (out[out.length - 1]?.type === 'separator') out.pop()
  return out
}

export const separator: Menu.Separator = { type: 'separator' }

const SNOOZE_LABEL = {
  next_push: 'Snooze until next push',
  tomorrow: 'Snooze until tomorrow',
  next_week: 'Snooze until next week',
} as const

/** The snooze menu's common choices as items (the custom date stays with the Snooze button's own menu). */
export function snoozeItems(
  allowNextPush: boolean,
  onSnooze: (choice: SnoozeChoice) => void,
): Menu.Item[] {
  const kinds = (['next_push', 'tomorrow', 'next_week'] as const).filter(
    (kind) => allowNextPush || kind !== 'next_push',
  )
  return kinds.map((kind) => ({
    label: SNOOZE_LABEL[kind],
    onSelect: () => onSnooze({ kind }),
  }))
}
