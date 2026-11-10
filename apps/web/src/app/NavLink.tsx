import { NavItem } from '@circi/ui'
import { type LinkComponentProps, useLinkProps, useMatchRoute } from '@tanstack/react-router'
import type { ReactNode } from 'react'

import { useOverlayStore } from '#lib/stores/overlay-store.ts'

/**
 * A sidebar entry that navigates through the router: real `href`, no page reload on click. It is
 * `selected` when the current address is its own, unless the caller says otherwise.
 */
export function NavLink({
  icon,
  trailing,
  selected,
  children,
  sub,
  more,
  count,
  countTone,
  countLabel,
  expands,
  ...link
}: NavLink.Props) {
  const { href, onClick: navigate } = useLinkProps(link)
  const setDrawerAt = useOverlayStore((s) => s.setDrawerAt)
  // In the narrow-screen drawer, an entry that expands (a team) keeps the drawer open on the page
  // it leads to; any other entry closes it, even one for the page already shown.
  const onClick =
    navigate && href
      ? (event: Parameters<typeof navigate>[0]) => {
          if (useOverlayStore.getState().drawerAt !== undefined) {
            setDrawerAt(expands ? new URL(href, window.location.origin).pathname : undefined)
          }
          navigate(event)
        }
      : navigate
  const matchRoute = useMatchRoute()
  const isCurrent = selected ?? Boolean(matchRoute({ to: link.to, params: link.params }))
  return (
    <NavItem
      {...(href ? { href } : {})}
      {...(onClick ? { onClick } : {})}
      {...(icon ? { icon } : {})}
      {...(trailing ? { trailing } : {})}
      {...(isCurrent ? { selected: true } : {})}
      {...(sub ? { sub } : {})}
      {...(more ? { more } : {})}
      {...(count === undefined ? {} : { count })}
      {...(countTone ? { countTone } : {})}
      {...(countLabel ? { countLabel } : {})}
    >
      {children}
    </NavItem>
  )
}

export namespace NavLink {
  export type Props = Pick<LinkComponentProps, 'to' | 'params' | 'search'> & {
    children: ReactNode
    icon?: ReactNode
    trailing?: ReactNode
    selected?: boolean
    sub?: boolean
    more?: boolean
    count?: number
    countTone?: NavItem.Props['countTone']
    countLabel?: string
    /** The entry opens a group of entries (a team): choosing it keeps the narrow-screen drawer open. */
    expands?: boolean
  }
}
