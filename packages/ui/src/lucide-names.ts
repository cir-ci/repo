import { iconNames } from 'lucide-react/dynamic.mjs'

/**
 * Every icon name of the installed lucide-react. `@circi/core` keeps a generated copy that the
 * server validates a project's icon against (`pnpm icons:generate`); `apps/web/test` checks the two
 * are equal. Not part of the package index: it pulls in Lucide's whole icon map.
 */
export const LUCIDE_ICON_NAMES: readonly string[] = iconNames
