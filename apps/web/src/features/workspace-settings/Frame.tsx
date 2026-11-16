import type { ReactNode } from 'react'

import { settingsCrumbsFor, workspaceSettingsCrumb } from '#lib/crumbs.ts'
import { PageFrame } from '#lib/PageFrame.tsx'

/**
 * The header and the one centred column every settings page here shares, with its loading and
 * error states. A workspace page passes `workspace` (display name and slug) and gets `Workspace /
 * Settings / Page` (see `lib/crumbs.ts`) and, for instance admins, a "‹ Workspace" way back to
 * its settings hub; an account or instance page passes plain `crumbs`.
 */
export function Frame({ crumbs, workspace, page, children, ...rest }: Frame.Props) {
  return (
    <PageFrame
      crumbs={
        workspace
          ? settingsCrumbsFor(workspace, [workspaceSettingsCrumb(workspace.slug)])
          : (crumbs ?? []).slice(0, -1).map((label) => ({ label }))
      }
      title={page ?? crumbs?.at(-1) ?? ''}
      {...rest}
    >
      {children}
    </PageFrame>
  )
}

export namespace Frame {
  export interface Props {
    /** A workspace settings page: the workspace's display name and slug. */
    workspace?: { slug: string; name: string }
    /** The page's `<h1>` for a workspace page. */
    page?: string
    /** Otherwise the path to the page as plain text, outermost first; the last is the `<h1>`. */
    crumbs?: string[]
    width?: 'default' | 'wide'
    loading?: boolean
    error?: Error | null
    onRetry?: () => void
    notFound?: string
    /** Replaces the page's content for someone who may not see it (a `Navigate` sends them elsewhere). */
    forbidden?: ReactNode
    children: ReactNode
  }
}
