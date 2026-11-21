import { useState } from 'react';
import { Box, Button, Tooltip, IconButton } from '@mui/material';
import LightModeIcon from '@mui/icons-material/LightMode';
import DarkModeIcon from '@mui/icons-material/DarkMode';
import { useTheme } from '@ds/utils';
import { DesignSystemPage } from './pages/DesignSystemPage';
import { ComponentsPage } from './pages/ComponentsPage';

// ADR-382: the playground is a UI-only design-system gallery. The former live
// server pages (Protocol Simulator, Identity, Demo Login) were removed — they
// were the only playground callers of the :4001 API.
type Page = 'design-system' | 'components';

const pages: Page[] = ['design-system', 'components'];

const pageLabels: Record<Page, string> = {
  'design-system': 'Design System',
  'components': 'Components',
};

export function App() {
  const [page, setPage] = useState<Page>('design-system');
  const { theme, toggleTheme } = useTheme();

  return (
    <Box
      sx={{
        minHeight: '100vh',
        bgcolor: 'background.default',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Header */}
      <header className="sticky top-0 z-10 border-b shadow-sm border-border-default bg-surface-primary">
        <div className="flex items-center justify-between max-w-6xl px-6 py-4 mx-auto">
          <div>
            <span className="text-lg font-semibold text-text-default">
              Colabonate DS
            </span>
            <span className="ml-2 rounded-full bg-surface-secondary px-2 py-0.5 text-xs text-text-muted">
              Playground
            </span>
          </div>
          <nav className="flex items-center gap-2">
            {pages.map((p) => (
              <Button
                key={p}
                onClick={() => setPage(p)}
                variant={page === p ? 'contained' : 'text'}
                color="primary"
                size="small"
                sx={{ textTransform: 'none', fontWeight: page === p ? 600 : 400 }}
              >
                {pageLabels[p]}
              </Button>
            ))}

            {/* Divider */}
            <Box sx={{ width: '1px', height: 20, bgcolor: 'divider', mx: 0.5 }} />

            {/* Theme Toggle */}
            <Tooltip title={theme === 'light' ? 'Enable dark mode' : 'Enable light mode'}>
              <IconButton
                onClick={toggleTheme}
                size="small"
                color="inherit"
                aria-label="Toggle theme"
                sx={{ color: 'text.secondary' }}
              >
                {theme === 'light' ? <DarkModeIcon fontSize="small" /> : <LightModeIcon fontSize="small" />}
              </IconButton>
            </Tooltip>
          </nav>
        </div>
      </header>

      {/* Content Container */}
      <Box
        id="content-container"
        className="flex-1 w-full max-w-[1536px] mx-auto px-4 sm:px-6 md:px-8 py-8 sm:py-12 md:py-16 bg-background-paper flex flex-col"
      >
        {page === 'design-system' ? <DesignSystemPage /> : <ComponentsPage />}
      </Box>
    </Box>
  );
}
