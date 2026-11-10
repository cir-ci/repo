import type { Menu } from '@circi/ui'

import { clipboard } from '#lib/clipboard.ts'
import { toast } from '#lib/toast.ts'

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

export function openInNewTabItem(href: string): Menu.Item {
  return {
    label: 'Open in new tab',
    onSelect: () => void window.open(absolute(href), '_blank', 'noopener'),
  }
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
