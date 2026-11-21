/**
 * useTheme – Dark/Light Theme Context
 *
 * Four-state preference model:
 * - Preference: 'system' (default) | 'time' | 'light' | 'dark'
 * - 'system' follows the OS preference (`prefers-color-scheme`) across
 *   desktop and mobile (Android/iOS).
 * - 'time' follows the local day/night cycle: light between 06:00 and 18:00,
 *   dark otherwise. Re-evaluated every 60s so the switch happens at the
 *   boundary even if the tab stays open.
 * - Only an explicit user choice is persisted; the system default is never
 *   written to storage, so the app keeps following OS changes until the user
 *   opts out.
 * - Resolved `theme` ('light' | 'dark') is applied via data-theme on <html>.
 *
 * Verwendung:
 *   <ThemeProvider><App /></ThemeProvider>
 *   const { theme, themePreference, setThemePreference } = useTheme();
 */

import { createContext, useContext, useEffect, useMemo, useState } from 'react';

export type Theme = 'light' | 'dark';
export type ThemePreference = 'system' | 'time' | 'light' | 'dark';

const STORAGE_KEY = 'colabonate-theme';
const SYSTEM_DARK_QUERY = '(prefers-color-scheme: dark)';

const TIME_LIGHT_START_HOUR = 6;
const TIME_DARK_START_HOUR = 18;

interface ThemeContextValue {
  theme: Theme;
  themePreference: ThemePreference;
  setTheme: (theme: Theme) => void;
  setThemePreference: (preference: ThemePreference) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: 'light',
  themePreference: 'system',
  setTheme: () => {},
  setThemePreference: () => {},
  toggleTheme: () => {},
});

function readStoredPreference(): ThemePreference | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'system' || stored === 'time' || stored === 'light' || stored === 'dark') return stored;
  } catch {
    // localStorage nicht verfügbar (SSR etc.)
  }
  return null;
}

function getInitialPreference(): ThemePreference {
  return readStoredPreference() ?? 'system';
}

function systemPrefersDark(): boolean {
  return typeof window !== 'undefined' && window.matchMedia(SYSTEM_DARK_QUERY).matches;
}

function timePrefersDark(now: Date = new Date()): boolean {
  const hour = now.getHours();
  return hour < TIME_LIGHT_START_HOUR || hour >= TIME_DARK_START_HOUR;
}

function resolveTheme(
  preference: ThemePreference,
  systemDark: boolean,
  timeDark: boolean,
): Theme {
  if (preference === 'system') return systemDark ? 'dark' : 'light';
  if (preference === 'time') return timeDark ? 'dark' : 'light';
  return preference;
}

function persistPreference(preference: ThemePreference) {
  try {
    localStorage.setItem(STORAGE_KEY, preference);
  } catch {
    // ignore
  }
}

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  root.setAttribute('data-theme', theme);

  // Force background update - workaround for CSS variable cascade issue
  const bgColor = theme === 'dark'
    ? 'var(--color-secondary-90)'
    : 'var(--color-neutral-9)';
  root.style.backgroundColor = bgColor;

  // Clear inline style after a frame to let CSS take over
  requestAnimationFrame(() => {
    root.style.removeProperty('background-color');
  });
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [preference, setPreference] = useState<ThemePreference>(getInitialPreference);
  const [systemDark, setSystemDark] = useState<boolean>(systemPrefersDark);
  const [timeDark, setTimeDark] = useState<boolean>(() => timePrefersDark());

  const theme = useMemo<Theme>(
    () => resolveTheme(preference, systemDark, timeDark),
    [preference, systemDark, timeDark],
  );

  // Apply resolved theme to <html>.
  // NOTE: persistence is intentionally NOT done here — only explicit user
  // choices are persisted, so the system default never clobbers "follow OS".
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  // Live-follow the OS preference (desktop / Android / iOS). The listener is
  // always active, but it only changes the resolved theme while preference is
  // 'system'.
  useEffect(() => {
    const mq = window.matchMedia(SYSTEM_DARK_QUERY);
    const handler = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  // Live-follow the local day/night cycle while preference is 'time'.
  // Tick every 60s so a long-open tab crosses the 06:00 / 18:00 boundary
  // without needing a reload.
  useEffect(() => {
    if (preference !== 'time') return;
    setTimeDark(timePrefersDark());
    const id = window.setInterval(() => setTimeDark(timePrefersDark()), 60_000);
    return () => window.clearInterval(id);
  }, [preference]);

  const setThemePreference = (p: ThemePreference) => {
    setPreference(p);
    persistPreference(p);
  };

  const setTheme = (t: Theme) => setThemePreference(t);

  const toggleTheme = () => {
    const next: Theme = theme === 'light' ? 'dark' : 'light';
    setThemePreference(next);
  };

  const value = useMemo<ThemeContextValue>(
    () => ({ theme, themePreference: preference, setTheme, setThemePreference, toggleTheme }),
    [theme, preference],
  );

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}
