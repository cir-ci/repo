import { createTheme } from '@mui/material/styles'

/** One theme with light and dark schemes; the system setting picks between them. */
export const theme = createTheme({
  cssVariables: { colorSchemeSelector: 'media' },
  colorSchemes: {
    light: {
      palette: {
        primary: { main: '#4f46e5' },
        background: { default: '#f8fafc', paper: '#ffffff' },
      },
    },
    dark: {
      palette: {
        primary: { main: '#818cf8' },
        background: { default: '#0b1120', paper: '#111827' },
      },
    },
  },
  shape: { borderRadius: 10 },
  typography: {
    fontFamily: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    h1: { fontSize: '1.5rem', fontWeight: 700 },
    h2: { fontSize: '1rem', fontWeight: 600 },
    button: { textTransform: 'none' },
  },
  components: {
    MuiPaper: { defaultProps: { variant: 'outlined' } },
    MuiChip: { defaultProps: { size: 'small' } },
  },
})
