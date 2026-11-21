import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider as MuiThemeProvider, CssBaseline } from '@mui/material';
import { ThemeProvider, useTheme } from '@ds/utils';
import { createColabonateTheme } from '@ds/ui';
import { LocaleProvider } from '../../colabonate-app/src/contexts/LocaleContext';
import './index.css';
import { App } from './App';

// Innerer Wrapper: liest useTheme() und synchronisiert MUI-Theme
function MuiThemeSync({ children }: { children: React.ReactNode }) {
  const { theme } = useTheme();
  const muiTheme = createColabonateTheme(theme);
  return (
    <MuiThemeProvider theme={muiTheme}>
      <CssBaseline />
      {children}
    </MuiThemeProvider>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <LocaleProvider>
        <MuiThemeSync>
          <App />
        </MuiThemeSync>
      </LocaleProvider>
    </ThemeProvider>
  </StrictMode>
);
