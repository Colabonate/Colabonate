import { createTheme, type PaletteMode } from '@mui/material/styles';
import tokens from '@ds/tokens';

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
        light: tokens.color.primary[30],
        main: tokens.color.primary[50],
        dark: tokens.color.primary[70],
        contrastText: tokens.color.neutral.white,
      },
      secondary: {
        light: tokens.color.secondary[30],
        main: tokens.color.secondary[50],
        dark: tokens.color.secondary[70],
        contrastText: tokens.color.neutral.white,
      },
      error: {
        main: tokens.color.status.error,
      },
      success: {
        main: tokens.color.status.success,
      },
      info: {
        main: tokens.color.status.info,
      },
      warning: {
        main: tokens.color.accent[2],
      },
      text: {
        primary:   mode === 'dark' ? tokens.color.text.neutral['on-neutral'] : tokens.color.text.default.primary,
        secondary: mode === 'dark' ? tokens.color.neutral[6] : tokens.color.text.default.secondary,
        disabled:  mode === 'dark' ? tokens.color.neutral[3] : tokens.color.neutral[6],
      },
      background: {
        default: mode === 'dark' ? tokens.color.secondary[80] : tokens.color.neutral[9],
        paper:   mode === 'dark' ? tokens.color.secondary[70] : tokens.color.neutral.white,
      },
      divider: mode === 'dark' ? 'rgba(255,255,255,0.08)' : tokens.color.neutral[7],
    },

    typography: {
      fontFamily: tokens.typography.fontFamily.sans,
      h1: {
        fontFamily: tokens.typography.fontFamily.barlow,
        fontSize: '32px',
        fontWeight: 700,
        lineHeight: '36px',
        letterSpacing: '-0.32px',
      },
      h2: {
        fontFamily: tokens.typography.fontFamily.barlow,
        fontSize: '29px',
        fontWeight: 700,
        lineHeight: '32px',
        letterSpacing: '-0.29px',
      },
      h3: {
        fontFamily: tokens.typography.fontFamily.barlow,
        fontSize: '26px',
        fontWeight: 600,
        lineHeight: '32px',
        letterSpacing: '-0.26px',
      },
      h4: {
        fontFamily: tokens.typography.fontFamily.sans,
        fontSize: '23px',
        fontWeight: 600,
        lineHeight: '24px',
        letterSpacing: '-0.23px',
      },
      h5: {
        fontFamily: tokens.typography.fontFamily.sans,
        fontSize: '20px',
        fontWeight: 600,
        lineHeight: '24px',
      },
      h6: {
        fontFamily: tokens.typography.fontFamily.sans,
        fontSize: '18px',
        fontWeight: 600,
        lineHeight: '20px',
      },
      subtitle1: {
        fontSize: '17px',
        fontWeight: 600,
        lineHeight: '24px',
      },
      subtitle2: {
        fontSize: '15px',
        fontWeight: 600,
        lineHeight: '22px',
      },
      body1: {
        fontSize: '15px',
        fontWeight: 400,
        lineHeight: '22px',
      },
      body2: {
        fontSize: '13px',
        fontWeight: 400,
        lineHeight: '18px',
      },
      caption: {
        fontSize: '12px',
        fontWeight: 400,
        lineHeight: '16px',
      },
      overline: {
        fontSize: '11px',
        fontWeight: 600,
        lineHeight: '16px',
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
      },
      button: {
        fontFamily: tokens.typography.fontFamily.sans,
        fontWeight: 600,
        textTransform: 'none',
      },
    },

    spacing: 4,

    shape: {
      borderRadius: 4,
    },

    components: {
      MuiButton: {
        styleOverrides: {
          root: {
            borderRadius: 4,
            padding: '8px 16px',
            fontWeight: 600,
          },
        },
      },
      MuiTextField: {
        defaultProps: {
          variant: 'outlined',
        },
      },
      MuiCard: {
        styleOverrides: {
          root: {
            borderRadius: 8,
          },
        },
      },
    },
  });
}

const colabonateTheme = createColabonateTheme('light');
export default colabonateTheme;
