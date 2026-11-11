import { Button, ChevronLeftIcon } from '@circi/ui'
import type { NavigateOptions } from '@tanstack/react-router'

import { useClientLink } from '#lib/use-client-link.ts'

/** The way up one level inside settings, at the top of a page's column: "‹ Projects", "‹ Web App". */
export function SettingsBackLink({ label, link }: SettingsBackLink.Props) {
  const clientLink = useClientLink()
  return (
    <Button size="sm" variant="ghost" {...clientLink(link)}>
      <ChevronLeftIcon size={14} />
      {label}
    </Button>
  )
}

export namespace SettingsBackLink {
  export interface Props {
    label: string
    link: NavigateOptions
  }
}
