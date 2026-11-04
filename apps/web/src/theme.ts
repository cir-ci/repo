import { createTheme } from '@mui/material/styles'

/**
 * MUI theme following Primer's foundations (https://primer.style): functional colours from
 * Primer's MIT-licensed primitives, a 14px base, 6px radii, quiet borders instead of shadows.
 * Light and dark schemes follow the system setting.
 */
export const theme = createTheme({
  cssVariables: { colorSchemeSelector: 'media' },
  colorSchemes: {
    light: {
      palette: {
        primary: { main: '#0969da' },
        secondary: { main: '#8250df' },
        success: { main: '#1a7f37' },
        warning: { main: '#9a6700' },
        error: { main: '#d1242f' },
        info: { main: '#0969da' },
        text: { primary: '#1f2328', secondary: '#59636e' },
        divider: '#d1d9e0',
        background: { default: '#ffffff', paper: '#ffffff' },
        action: { hover: 'rgba(208, 215, 222, 0.32)', selected: 'rgba(208, 215, 222, 0.48)' },
      },
    },
    dark: {
      palette: {
        primary: { main: '#4493f8' },
        secondary: { main: '#ab7df8' },
        success: { main: '#3fb950' },
        warning: { main: '#d29922' },
        error: { main: '#f85149' },
        info: { main: '#4493f8' },
        text: { primary: '#f0f6fc', secondary: '#9198a1' },
        divider: '#3d444d',
        background: { default: '#0d1117', paper: '#0d1117' },
        action: { hover: 'rgba(101, 108, 118, 0.2)', selected: 'rgba(101, 108, 118, 0.32)' },
      },
    },
  },
  shape: { borderRadius: 6 },
  typography: {
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif',
    fontSize: 14,
    // Primer's title sizes: medium 20px for page titles, 16px for section titles.
    h1: { fontSize: '1.25rem', fontWeight: 600, lineHeight: 1.5 },
    h2: { fontSize: '1rem', fontWeight: 600, lineHeight: 1.5 },
    h3: { fontSize: '0.875rem', fontWeight: 600, lineHeight: 1.5 },
    body1: { fontSize: '0.875rem', lineHeight: 1.5 },
    body2: { fontSize: '0.75rem', lineHeight: 1.5 },
    button: { textTransform: 'none', fontWeight: 500 },
  },
  components: {
    MuiPaper: { defaultProps: { variant: 'outlined', elevation: 0 } },
    MuiButton: { defaultProps: { disableElevation: true, size: 'small' } },
    MuiLink: { defaultProps: { underline: 'hover' } },
    MuiToggleButton: { styleOverrides: { root: { paddingBlock: 2, fontSize: '0.75rem' } } },
  },
})

/** Monospace stack used for SHAs and branch names. */
export const monoFont =
  'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace'

/** For text that screen readers need but sighted users don't (Primer's visually-hidden). */
export const visuallyHidden = {
  position: 'absolute',
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: 'hidden',
  clip: 'rect(0, 0, 0, 0)',
  whiteSpace: 'nowrap',
  border: 0,
} as const
