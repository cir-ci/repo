import type { Plugin } from 'vite'

import { COLOR_SCHEME_ATTRIBUTE, monoFont, sansFont, tokenVariables } from './src/theme.ts'

const MARKER = '/* @circi-tokens */'

const block = (selector: string, variables: Record<string, string>) =>
  `${selector} {\n${Object.entries(variables)
    .map(([name, value]) => `  ${name}: ${value};`)
    .join('\n')}\n}\n`

/** The token variables for both schemes plus the font stacks, as CSS. Dark is the default. */
export function tokensCss(): string {
  const fonts = { '--circi-font-sans': sansFont, '--circi-font-mono': monoFont }
  // One stacking scale: dialogs above content, menus and selects above dialogs, tooltips above those.
  const layers = {
    '--circi-z-dialog': '100',
    '--circi-z-popup': '200',
    '--circi-z-tooltip': '300',
    '--circi-z-skip': '400',
  }
  // Corner radii: 4 inline marks, 6 controls and items, 8 popups and tooltips, 10 panels and dialogs, 12 command menu.
  const radii = {
    '--circi-radius-inline': '4px',
    '--circi-radius-control': '6px',
    '--circi-radius-popup': '8px',
    '--circi-radius-panel': '10px',
    '--circi-radius-command': '12px',
  }
  return [
    block(':root', {
      'color-scheme': 'dark',
      ...tokenVariables('dark'),
      ...fonts,
      ...layers,
      ...radii,
    }),
    block(`[${COLOR_SCHEME_ATTRIBUTE}='dark']`, {
      'color-scheme': 'dark',
      ...tokenVariables('dark'),
    }),
    block(`[${COLOR_SCHEME_ATTRIBUTE}='light']`, {
      'color-scheme': 'light',
      ...tokenVariables('light'),
    }),
  ].join('\n')
}

/**
 * Vite plugin: replaces the marker in `src/global.css` with `tokensCss()`. Used by the library
 * build; add it to `apps/web`'s Vite config (and Vitest's) wherever the source is consumed.
 */
export function circiTokensCss(): Plugin {
  return {
    name: 'circi-tokens-css',
    enforce: 'pre',
    transform(code, id) {
      if (!id.split('?')[0]?.endsWith('/global.css')) return null
      return { code: code.replace(MARKER, tokensCss()), map: null }
    },
  }
}
