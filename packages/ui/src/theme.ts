import { createTheme } from '@mui/material/styles'

/**
 * The CirCI palette. Brand tones come from the logo; neutrals carry the logo's hue at very low
 * chroma so greys read warm. State colours are the accent's complement (teal) and its triad
 * (amber, periwinkle), and they differ in lightness as well as hue.
 */
export const tokens = {
  brand: {
    maroon: '#724039',
    blush: '#e4b1a7',
    rosewood: '#d49689',
    salmon: '#d48677',
    terracotta: '#b96e5f',
  },
  /** Elevation, dimmest to highest. `chrome` is the sidebar and page ground; `panel` the content. */
  surface: {
    chrome: '#0c0a09',
    panel: '#131110',
    raised: '#1a1716',
    overlay: '#221e1d',
    highest: '#2b2625',
  },
  text: { primary: '#ede6e3', secondary: '#a89d98', tertiary: '#8c817c' },
  accent: { main: '#d9806d', text: '#eaa493', onAccent: '#1c0f0c' },
  state: { approved: '#5cb8a8', review: '#e2b04a', processing: '#9aa3f7', rejected: '#f2707f' },
  line: { subtle: 'rgba(255,255,255,0.07)', strong: 'rgba(255,255,255,0.12)' },
} as const

export const sansFont =
  '"Inter Variable", Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif'

/** For SHAs, branch names and anything the reader may copy. */
export const monoFont =
  '"JetBrains Mono Variable", "JetBrains Mono", ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace'

/** MUI theme for the dashboard. Dark only. */
export const theme = createTheme({
  palette: {
    mode: 'dark',
    primary: { main: tokens.accent.main, contrastText: tokens.accent.onAccent },
    secondary: { main: tokens.state.processing, contrastText: tokens.surface.chrome },
    success: { main: tokens.state.approved, contrastText: tokens.surface.chrome },
    warning: { main: tokens.state.review, contrastText: tokens.surface.chrome },
    error: { main: tokens.state.rejected, contrastText: tokens.surface.chrome },
    info: { main: tokens.state.processing, contrastText: tokens.surface.chrome },
    text: {
      primary: tokens.text.primary,
      secondary: tokens.text.secondary,
      disabled: tokens.text.tertiary,
    },
    divider: tokens.line.subtle,
    background: { default: tokens.surface.chrome, paper: tokens.surface.panel },
    action: { hover: 'rgba(255,255,255,0.045)', selected: 'rgba(255,255,255,0.075)' },
  },
  shape: { borderRadius: 6 },
  typography: {
    fontFamily: sansFont,
    fontSize: 13,
    h1: { fontSize: '1.25rem', fontWeight: 600, letterSpacing: '-0.01em', lineHeight: 1.4 },
    h2: { fontSize: '0.9375rem', fontWeight: 600, lineHeight: 1.5 },
    h3: { fontSize: '0.8125rem', fontWeight: 600, lineHeight: 1.5 },
    body1: { fontSize: '0.8125rem', lineHeight: 1.5 },
    body2: { fontSize: '0.75rem', lineHeight: 1.5 },
    button: { textTransform: 'none', fontWeight: 500, fontSize: '0.75rem' },
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        body: { WebkitFontSmoothing: 'antialiased', backgroundColor: tokens.surface.chrome },
      },
    },
    // Hairlines instead of shadows: structure is felt, not seen.
    MuiPaper: {
      defaultProps: { variant: 'outlined', elevation: 0 },
      styleOverrides: { root: { backgroundImage: 'none' } },
    },
    MuiButton: {
      defaultProps: { disableElevation: true, size: 'small' },
      styleOverrides: {
        root: { height: 28, borderRadius: 6, paddingInline: 10 },
        outlined: {
          borderColor: tokens.line.strong,
          backgroundColor: tokens.surface.raised,
          color: tokens.text.primary,
          '&:hover': { backgroundColor: tokens.surface.overlay, borderColor: tokens.line.strong },
        },
      },
    },
    MuiLink: {
      defaultProps: { underline: 'hover' },
      styleOverrides: { root: { color: tokens.accent.text } },
    },
    MuiToggleButton: { styleOverrides: { root: { paddingBlock: 2, fontSize: '0.75rem' } } },
    MuiOutlinedInput: {
      styleOverrides: { root: { backgroundColor: tokens.surface.raised, borderRadius: 6 } },
    },
  },
})

/** For text that screen readers need but sighted users don't. */
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
