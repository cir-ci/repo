import { NavItem } from '@circi/ui'
import { type LinkComponentProps, useLinkProps, useMatchRoute } from '@tanstack/react-router'
import type { ReactNode } from 'react'

/**
 * A sidebar entry that navigates through the router: real `href`, no page reload on click. It is
 * `selected` when the current address is its own, unless the caller says otherwise.
 */
export function NavLink({
  icon,
  trailing,
  selected,
  within,
  children,
  sub,
  more,
  count,
  countTone,
  countLabel,
  ...link
}: NavLink.Props) {
  const { href, onClick } = useLinkProps(link)
  const matchRoute = useMatchRoute()
  const isCurrent = selected ?? Boolean(matchRoute({ to: link.to, params: link.params }))
  return (
    <NavItem
      {...(href ? { href } : {})}
      {...(onClick ? { onClick } : {})}
      {...(icon ? { icon } : {})}
      {...(trailing ? { trailing } : {})}
      {...(isCurrent ? { selected: true } : {})}
      {...(within ? { within } : {})}
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
    /** The current page is inside this entry: a quieter highlight (`NavItem`'s `within`). */
    within?: boolean
    sub?: boolean
    more?: boolean
    count?: number
    countTone?: NavItem.Props['countTone']
    countLabel?: string
  }
}
