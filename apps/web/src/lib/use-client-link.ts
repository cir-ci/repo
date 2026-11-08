import { type NavigateOptions, useRouter } from '@tanstack/react-router'
import type { MouseEvent } from 'react'

/**
 * `href` and `onClick` for something that goes to a route: a real address (open in a new tab,
 * copy the link) and, on a plain click, client-side navigation with no page reload. Spread it on
 * `ListRow`, `Button` (with `href`) or `Breadcrumbs` items.
 */
export function useClientLink() {
  const router = useRouter()
  return (link: NavigateOptions) => ({
    href: router.buildLocation(link).href,
    onClick: (event: MouseEvent<HTMLElement>) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
        return
      event.preventDefault()
      void router.navigate(link)
    },
  })
}
