import { NavItem } from '@circi/ui'
import { type LinkComponentProps, useLinkProps } from '@tanstack/react-router'
import type { ReactNode } from 'react'

/** A sidebar entry that navigates through the router: real `href`, no page reload on click. */
export function NavLink({ icon, trailing, selected, children, ...link }: NavLink.Props) {
  const { href, onClick } = useLinkProps(link)
  return (
    <NavItem
      {...(href ? { href } : {})}
      {...(onClick ? { onClick } : {})}
      {...(icon ? { icon } : {})}
      {...(trailing ? { trailing } : {})}
      {...(selected ? { selected } : {})}
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
  }
}
