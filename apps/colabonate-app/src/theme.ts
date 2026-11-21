import { createTheme, type PaletteMode } from '@mui/material/styles'

// Lokale Kopie des Colabonate MUI Theme – vermeidet doppelte @emotion/react-Instanz
// durch Cross-Package-Import aus @ds/ui. Werte identisch mit packages/ui/theme.ts.

export function createColabonateTheme(mode: PaletteMode = 'light') {
  return createTheme({
    breakpoints: {
      values: {
        xs: 0,
        sm: 360,
        md: 600,
        lg: 900,
        xl: 1200,
      },
    },
    palette: {
      mode,
      primary: {
        light: '#F5A8A3',
        main: '#E84541',
        dark: '#B62A27',
        contrastText: '#FFFFFF',
      },
      secondary: {
        light: '#9EA8B0',
        main: '#3D4C53',
        dark: '#2D333B',
        contrastText: '#FFFFFF',
      },
      error:   { main: '#DA1414' },
      success: { main: '#23CA61' },
      info:    { main: '#2E5AAC' },
      warning: { main: '#F57C2A' },
      text: {
        primary:   mode === 'dark' ? '#f3f3f3'  : '#3c4f58',
        secondary: mode === 'dark' ? '#A5ABB3'  : '#757575',
        disabled:  mode === 'dark' ? '#545D69'  : '#A5ABB3',
      },
      background: {
        default: 'transparent',
        paper:   mode === 'dark' ? '#252C33' : '#FFFFFF',
      },
      divider: mode === 'dark' ? 'rgba(255,255,255,0.08)' : '#DADEE3',
    },
    typography: {
      fontFamily: "'Source Sans Pro', sans-serif",
      h1: { fontFamily: "'Source Sans Pro', sans-serif", fontSize: '32px', fontWeight: 600, lineHeight: '36px', letterSpacing: '-0.32px' },
      h2: { fontFamily: "'Source Sans Pro', sans-serif", fontSize: '29px', fontWeight: 500, lineHeight: '32px', letterSpacing: '-0.29px' },
      h3: { fontFamily: "'Source Sans Pro', sans-serif", fontSize: '26px', fontWeight: 400, lineHeight: '32px', letterSpacing: '-0.26px' },
      h4: { fontFamily: "'Source Sans Pro', sans-serif", fontSize: '23px', fontWeight: 300, lineHeight: '24px', letterSpacing: '-0.23px' },
      h5: { fontFamily: "'Source Sans Pro', sans-serif", fontSize: '20px', fontWeight: 200, lineHeight: '24px' },
      h6: { fontFamily: "'Source Sans Pro', sans-serif", fontSize: '18px', fontWeight: 100, lineHeight: '20px' },
      subtitle1: { fontSize: '18px', fontWeight: 600, lineHeight: '24px' },
      subtitle2: { fontSize: '15px', fontWeight: 600, lineHeight: '22px' },
      body1:   { fontSize: '15px', fontWeight: 400, lineHeight: '22px' },
      body2:   { fontSize: '14px', fontWeight: 400, lineHeight: '18px' },
      caption: { fontSize: '12px', fontWeight: 400, lineHeight: '16px' },
      overline: { fontSize: '11px', fontWeight: 600, lineHeight: '16px', letterSpacing: '0.08em', textTransform: 'uppercase' },
      button:  { fontFamily: "'Source Sans Pro', sans-serif", fontWeight: 600, textTransform: 'none' },
    },
    spacing: 4,
    shape: { borderRadius: 4 },
    components: {
      MuiButton: {
        styleOverrides: { root: { borderRadius: 4, padding: '8px 16px', fontWeight: 600 } },
      },
      MuiTextField: { defaultProps: { variant: 'outlined' } },
      MuiCard: { styleOverrides: { root: { borderRadius: 8 } } },
    },
  })
}

// Rückwärtskompatibilität
export default createColabonateTheme('light')
