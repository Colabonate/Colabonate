// Settings with tabs for different entity configurations
// Scope: ADR-037
import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Box,
  IconButton,
  Divider,
  List,
  ListItem,
  ListItemIcon,
  ListItemSecondaryAction,
  ListItemText,
  Paper,
  Switch,
  Typography,
  Tabs,
  Tab,
  Radio,
  RadioGroup,
  FormControlLabel,
  CircularProgress,
  Alert,
  Snackbar,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Autocomplete,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
} from '@mui/material'
import { usePref } from '../../utils/userPreferences'
import { assistantBaseUrlPresets } from '../../lib/llmProviderCatalog'
import { KPI_STRIP_SIZE_KEY, KPI_STRIP_COLLAPSED_KEY, clearKpiCollapseStorage } from '../../utils/kpiDisplayPrefs'
import type { KpiStripSize } from '../../utils/kpiDisplayPrefs'
import { NewsletterPreference } from '../../components/newsletter/NewsletterPreference'
import DarkModeIcon           from '@mui/icons-material/DarkMode'
import LightModeIcon          from '@mui/icons-material/LightMode'
import BrightnessAutoIcon     from '@mui/icons-material/BrightnessAuto'
import ScheduleIcon           from '@mui/icons-material/Schedule'
import StorefrontIcon         from '@mui/icons-material/Storefront'
import CategoryIcon           from '@mui/icons-material/Category'
import SettingsIcon           from '@mui/icons-material/Settings'
import ViewAgendaIcon         from '@mui/icons-material/ViewAgenda'
import SmartToyIcon           from '@mui/icons-material/SmartToy'
import DeleteOutlineIcon      from '@mui/icons-material/DeleteOutline'
import LocationOnIcon         from '@mui/icons-material/LocationOn'
import LockOutlinedIcon       from '@mui/icons-material/LockOutlined'
import AddIcon                from '@mui/icons-material/Add'
import CloudSyncIcon          from '@mui/icons-material/CloudSync'
import StorageIcon            from '@mui/icons-material/Storage'
import TerminalIcon           from '@mui/icons-material/Terminal'
import BoltIcon               from '@mui/icons-material/Bolt'
import InsightsIcon           from '@mui/icons-material/Insights'
import UnfoldLessIcon         from '@mui/icons-material/UnfoldLess'

import { useTheme } from '@ds/utils'
import type { ThemePreference } from '@ds/utils'
import { PageContainer } from '@ds/ui'
import { PageHeader } from '../../components/PageHeader'
import { SettingsWalletTab } from './SettingsWalletTab'
import { apiCall } from '../../lib/api'
import { getDmRelayList, setDmRelayListLocal, publishDmRelayList, DEFAULT_DM_RELAYS } from '../../lib/nostr-dm-relays'
import { BunkerConnectionPanel } from '../../components/settings/BunkerConnectionPanel'
import { AiCreditsPanel } from '../../components/ai-assistant/AiCreditsPanel'
import { COUNTRY_OPTIONS } from '../../components/offers/offerFormConstants'
import { AccountDeletionSection } from '../../components/gdpr/AccountDeletionSection'
import { CategoryMultiSelect, type StandardCategoryOption } from '../../components/category/CategoryMultiSelect'
import type { ProfileVisibility } from '../../types/api'

// ─── Design Tokens ────────────────────────────────────────────────────────────
const C = {
  surface:   'var(--theme-surface)',
  bg:        'var(--theme-bg)',
  text:      'var(--theme-text)',
  textMuted: 'var(--theme-text-muted)',
  border:    'var(--theme-border)',
} as const

// ─── Section Header ────────────────────────────────────────────────────────────
// Title uses a bare <h3>: responsive font-size/weight/line-height come from the
// global typography.css (mobile → tablet ≥600 → desktop ≥900). Subtitle and
// section rhythm still scale responsively via the sx breakpoints below.
function SectionHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <Box sx={{ mb: { xs: 2, md: 2.5, lg: 3 } }}>
      <h3 style={{ margin: 0, marginBottom: subtitle ? undefined : 0 }}>{title}</h3>
      {subtitle && (
        <Typography
          variant="caption"
          sx={{
            color: C.textMuted,
            fontSize: { xs: '0.75rem', md: '0.8125rem' },
            lineHeight: { xs: 1.4, md: 1.5 },
            display: 'block',
            mt: { xs: 0.5, md: 0.75 },
          }}
        >
          {subtitle}
        </Typography>
      )}
    </Box>
  )
}

// ─── Account Settings Tab ──────────────────────────────────────────────────────
function AccountSettingsTab({
  theme,
  themePreference,
  setThemePreference,
}: {
  theme: string
  themePreference: ThemePreference
  setThemePreference: (p: ThemePreference) => void
}) {
  const [profileVisibility, setProfileVisibility] = useState<ProfileVisibility>('PUBLIC')
  const [visibilitySaving, setVisibilitySaving] = useState(false)
  const [snackbarOpen, setSnackbarOpen] = useState(false)
  const [snackbarMsg, setSnackbarMsg] = useState('')
  const [categoryCodes, setCategoryCodes] = useState<string[]>([])
  const [allStandardCategories, setAllStandardCategories] = useState<StandardCategoryOption[]>([])
  const [categoriesLoading, setCategoriesLoading] = useState(true)
  const [categoriesSaving, setCategoriesSaving] = useState(false)
  const [hideEmptyCategories, setHideEmptyCategories] = usePref('hideEmptyCategories', false)
  const [showOfferCounts, setShowOfferCounts] = usePref('showOfferCounts', true)
  const [hidePageHeaders, setHidePageHeaders] = usePref('hidePageHeaders', false)
  const [kpiStripSize, setKpiStripSize] = usePref<KpiStripSize>(KPI_STRIP_SIZE_KEY, 'small')
  const [kpiStripCollapsed, setKpiStripCollapsed] = usePref<boolean>(KPI_STRIP_COLLAPSED_KEY, true)
  const [userCity, setUserCity] = usePref('userCity', '')
  const [userCountry, setUserCountry] = usePref('userCountry', '')
  const [draftCity, setDraftCity] = useState(userCity)
  const [draftCountry, setDraftCountry] = useState(userCountry)
  const locationDirty = draftCity !== userCity || draftCountry !== userCountry
  const evmAddress = (() => {
    try { return localStorage.getItem('evmAddress') } catch { return null }
  })()
  const authPubkey = (() => {
    try { return localStorage.getItem('pubkey') } catch { return null }
  })()

  useState(() => {
    const pubkey = localStorage.getItem('pubkey')
    if (!pubkey) return
    apiCall(`/api/user/${pubkey}/profile`)
      .then(r => r.json())
      .then(data => {
        if (data.visibility) setProfileVisibility(data.visibility)
      })
      .catch(() => {})
      .finally(() => {})
  })

  useEffect(() => {
    const pubkey = localStorage.getItem('pubkey')
    Promise.all([
      apiCall('/api/standard-categories/tree/flat').then(r => r.json()).catch(() => ({ standardCategories: [] })),
      pubkey ? apiCall(`/api/user/${pubkey}/categories`).then(r => r.json()).catch(() => ({ categoryCodes: [] })) : Promise.resolve({ categoryCodes: [] }),
    ]).then(([catRes, userRes]) => {
      setAllStandardCategories(catRes.standardCategories ?? [])
      setCategoryCodes(userRes.categoryCodes ?? [])
    }).finally(() => setCategoriesLoading(false))
  }, [])

  async function handleCategoriesChange(slugs: string[]) {
    const pubkey = localStorage.getItem('pubkey')
    if (!pubkey) return
    setCategoryCodes(slugs)
    setCategoriesSaving(true)
    try {
      await apiCall(`/api/user/${pubkey}/categories`, {
        method: 'PATCH',
        body: JSON.stringify({ categoryCodes: slugs }),
      })
    } catch {
      setSnackbarMsg('Failed to update categories')
      setSnackbarOpen(true)
    } finally {
      setCategoriesSaving(false)
    }
  }

  async function handleVisibilityChange(newVis: ProfileVisibility) {
    const pubkey = localStorage.getItem('pubkey')
    if (!pubkey) return
    setVisibilitySaving(true)
    try {
      const res = await apiCall(`/api/user/${pubkey}/visibility`, {
        method: 'PATCH',
        body: JSON.stringify({ profileVisibility: newVis, callerPubkey: pubkey }),
      })
      const data = await res.json()
      if (data.success) {
        setProfileVisibility(newVis)
        setSnackbarMsg(`Profile visibility set to ${newVis === 'PUBLIC' ? 'Public' : newVis === 'PSEUDO_PRIVATE' ? 'Pseudo-Private' : 'Private'}`)
        setSnackbarOpen(true)
      }
    } catch {
      setSnackbarMsg('Failed to update visibility')
      setSnackbarOpen(true)
    } finally {
      setVisibilitySaving(false)
    }
  }

  const switchSx = {
    '& .MuiSwitch-switchBase.Mui-checked': { color: 'var(--color-primary-50)' },
    '& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track': { backgroundColor: 'var(--color-primary-50)' },
    '& .MuiSwitch-track': { borderRadius: 13 },
    '& .MuiSwitch-thumb': { boxShadow: '0 1px 3px rgba(0,0,0,0.2)' },
  }

  return (
    <Box>
      <SectionHeader title="Appearance" subtitle="Customize your interface" />
      <Paper variant="outlined" sx={{ borderRadius: 2, borderColor: C.border, bgcolor: C.surface }}>
        <List disablePadding>
          <ListItem sx={{ py: 1.75, px: 2.5 }}>
            <ListItemIcon sx={{ minWidth: 40 }}>
              {theme === 'light' ? <LightModeIcon sx={{ color: C.textMuted }} /> : <DarkModeIcon sx={{ color: C.textMuted }} />}
            </ListItemIcon>
            <ListItemText
              primary={<Typography variant="body2" fontWeight={600} sx={{ color: C.text }}>Theme</Typography>}
              secondary={
                <Typography variant="caption" sx={{ color: C.textMuted }}>
                  {themePreference === 'system'
                    ? `System · Currently ${theme === 'light' ? 'Light' : 'Dark'}`
                    : themePreference === 'time'
                      ? `Day/Night · Currently ${theme === 'light' ? 'Light' : 'Dark'}`
                      : theme === 'light' ? 'Light' : 'Dark'}
                </Typography>
              }
            />
            <ListItemSecondaryAction>
              <ToggleButtonGroup
                exclusive
                size="small"
                value={themePreference}
                onChange={(_e, val: ThemePreference | null) => { if (val) setThemePreference(val) }}
                sx={{
                  '& .MuiToggleButton-root': {
                    px: 1,
                    py: 0.25,
                    borderColor: C.border,
                    color: C.textMuted,
                    '&.Mui-selected': { color: 'var(--color-primary-50)', bgcolor: 'transparent' },
                  },
                }}
              >
                <ToggleButton value="system" aria-label="Follow system theme"><BrightnessAutoIcon sx={{ fontSize: 18 }} /></ToggleButton>
                <ToggleButton value="time" aria-label="Follow day/night cycle"><ScheduleIcon sx={{ fontSize: 18 }} /></ToggleButton>
                <ToggleButton value="light" aria-label="Light theme"><LightModeIcon sx={{ fontSize: 18 }} /></ToggleButton>
                <ToggleButton value="dark" aria-label="Dark theme"><DarkModeIcon sx={{ fontSize: 18 }} /></ToggleButton>
              </ToggleButtonGroup>
            </ListItemSecondaryAction>
          </ListItem>
          <Divider component="li" sx={{ borderColor: C.border }} />
          <ListItem sx={{ py: 1.75, px: 2.5 }}>
            <ListItemIcon sx={{ minWidth: 40 }}>
              <InsightsIcon sx={{ color: C.textMuted }} />
            </ListItemIcon>
            <ListItemText
              primary={<Typography variant="body2" fontWeight={600} sx={{ color: C.text }}>KPI strip size</Typography>}
              secondary={<Typography variant="caption" sx={{ color: C.textMuted }}>Chip size for all KPI strips across the app</Typography>}
            />
            <ListItemSecondaryAction>
              <ToggleButtonGroup
                exclusive
                size="small"
                value={kpiStripSize}
                onChange={(_e, val: KpiStripSize | null) => { if (val) setKpiStripSize(val) }}
                sx={{
                  '& .MuiToggleButton-root': {
                    px: 1,
                    py: 0.25,
                    borderColor: C.border,
                    color: C.textMuted,
                    '&.Mui-selected': { color: 'var(--color-primary-50)', bgcolor: 'transparent' },
                  },
                }}
              >
                <ToggleButton value="small" aria-label="Small KPI chips">Small</ToggleButton>
                <ToggleButton value="large" aria-label="Large KPI chips">Large</ToggleButton>
              </ToggleButtonGroup>
            </ListItemSecondaryAction>
          </ListItem>
          <Divider component="li" sx={{ borderColor: C.border }} />
          <ListItem sx={{ py: 1.75, px: 2.5 }}>
            <ListItemIcon sx={{ minWidth: 40 }}>
              <UnfoldLessIcon sx={{ color: C.textMuted }} />
            </ListItemIcon>
            <ListItemText
              primary={<Typography variant="body2" fontWeight={600} sx={{ color: C.text }}>KPI strips collapsed on load</Typography>}
              secondary={<Typography variant="caption" sx={{ color: C.textMuted }}>Sections start collapsed (headings stay visible). Changing this resets your per-section toggles.</Typography>}
            />
            <ListItemSecondaryAction>
              <Switch
                checked={kpiStripCollapsed}
                onChange={(e) => { clearKpiCollapseStorage(); setKpiStripCollapsed(e.target.checked) }}
                size="small"
                sx={switchSx}
              />
            </ListItemSecondaryAction>
          </ListItem>
          <Divider component="li" sx={{ borderColor: C.border }} />
          <ListItem sx={{ py: 1.75, px: 2.5 }}>
            <ListItemIcon sx={{ minWidth: 40 }}>
              <ViewAgendaIcon sx={{ color: C.textMuted }} />
            </ListItemIcon>
            <ListItemText
              primary={<Typography variant="body2" fontWeight={600} sx={{ color: C.text }}>Hide page headers</Typography>}
              secondary={<Typography variant="caption" sx={{ color: C.textMuted }}>Removes page headers from all pages to save space</Typography>}
            />
            <ListItemSecondaryAction>
              <Switch
                checked={hidePageHeaders}
                onChange={(e) => setHidePageHeaders(e.target.checked)}
                size="small"
                sx={switchSx}
              />
            </ListItemSecondaryAction>
          </ListItem>
          <Divider component="li" sx={{ borderColor: C.border }} />
        </List>
      </Paper>

      <Box sx={{ mt: { xs: 3, md: 4, lg: 5 } }}>
        <SectionHeader title="Notifications" subtitle="Choose which emails you get from Colabonate" />
        <Paper variant="outlined" sx={{ borderRadius: 2, borderColor: C.border, bgcolor: C.surface }}>
          <List disablePadding>
            {/* ADR-402 D15/D15.6: real newsletter opt-in/out; replaces a local-only
                "Notifications" switch that was never saved and had no effect. */}
            <NewsletterPreference variant="settings" />
            <Divider component="li" sx={{ borderColor: C.border }} />
          </List>
        </Paper>
      </Box>

      <Box sx={{ mt: { xs: 3, md: 4, lg: 5 } }}>
        <SectionHeader title="Nostr Identity" subtitle="Connect a NIP-46 bunker for a real, portable Nostr key (ADR-154)" />
        <BunkerConnectionPanel />
      </Box>

      {evmAddress && (
        <Box sx={{ mt: { xs: 3, md: 4, lg: 5 } }}>
          <SectionHeader title="Authentication" subtitle="Your current login method" />
          <Paper variant="outlined" sx={{ borderRadius: 2, borderColor: C.border, bgcolor: C.surface }}>
            <List disablePadding>
              <ListItem sx={{ py: 1.75, px: 2.5 }}>
                <ListItemIcon sx={{ minWidth: 40 }}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                    <path d="M21.1 1.5L13.6 7.8l-1.3-2.7 8.8-3.6z" fill="#E17726" />
                    <path d="M2.9 1.5l7.4 6.3-1.2 2.7-8.6-3.5z" fill="#E27625" />
                    <path d="M19.1 15.5l-2.3 3.5 5 1.5 1.4-4.8z" fill="#E27625" />
                    <path d="M.8 15.7l1.4 4.8 5-1.5-2.3-3.5z" fill="#E27625" />
                    <path d="M6.5 10.8l-1.5 2.2 6.5.3-.2-7z" fill="#E27625" />
                    <path d="M17.5 10.8l-4.7-4.6-.3 7.1 6.5-.3z" fill="#E27625" />
                    <path d="M6.5 18.9l3.9-1.9-3.3-2.6z" fill="#E27625" />
                    <path d="M13.6 17l3.9 1.9-.6-4.5z" fill="#E27625" />
                    <path d="M16.8 14.4l-3.2 2.4 3.7.5z" fill="#D5BFB2" />
                    <path d="M7.2 14.4l-.5 3 3.7-.5z" fill="#D5BFB2" />
                    <path d="M10.4 16.8l-.4-3.3-2.8.6z" fill="#233447" />
                    <path d="M13.6 16.8l3.2-2.7-2.8-.6z" fill="#233447" />
                    <path d="M13.6 16.8l-3.2 0-.2-3.4h3.6z" fill="#CC6228" />
                    <path d="M17.5 10.8l-4.8 2.6.2 3.4 4.7-2.7z" fill="#E27525" />
                    <path d="M6.5 10.8l-.1 3.3 4.8 2.7.2-3.4z" fill="#E27525" />
                    <path d="M6.5 10.8l4.9-2.5-4.6-1.7z" fill="#F5841F" />
                    <path d="M17.5 10.8l-.3-4.2-4.6 1.7 4.9 2.5z" fill="#F5841F" />
                    <path d="M13.6 7.8l4.6-1.7-3.9-3.3z" fill="#C0AC9D" />
                    <path d="M6.5 10.8l4.6-3-4.4-1.4z" fill="#C0AC9D" />
                    <path d="M10.4 16.8l3.2 0-.3 2z" fill="#E17726" />
                  </svg>
                </ListItemIcon>
                <ListItemText
                  primary={<Typography variant="body2" fontWeight={600} sx={{ color: C.text }}>MetaMask</Typography>}
                  secondary={
                    <Typography variant="caption" sx={{ color: C.textMuted }}>
                      {evmAddress}
                    </Typography>
                  }
                />
              </ListItem>
              <Divider component="li" sx={{ borderColor: C.border }} />
              <ListItem sx={{ py: 1.75, px: 2.5 }}>
                <ListItemIcon sx={{ minWidth: 40 }}>
                  <LockOutlinedIcon sx={{ color: C.textMuted }} />
                </ListItemIcon>
                <ListItemText
                  primary={<Typography variant="body2" fontWeight={600} sx={{ color: C.text }}>Derived Nostr pubkey</Typography>}
                  secondary={
                    <Typography variant="caption" sx={{ color: C.textMuted, fontFamily: 'monospace' }}>
                      {authPubkey}
                    </Typography>
                  }
                />
              </ListItem>
            </List>
          </Paper>
        </Box>
      )}

      <Box sx={{ mt: { xs: 3, md: 4, lg: 5 } }}>
        <SectionHeader title="Privacy" subtitle="Control what other users see on your profile page (/u/your-pubkey)" />
        <Paper variant="outlined" sx={{ borderRadius: 2, borderColor: C.border, bgcolor: C.surface }}>
          <Box sx={{ px: 2.5, py: 2 }}>
            {visibilitySaving && (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                <CircularProgress size={14} />
                <Typography variant="caption" sx={{ color: C.textMuted }}>Saving…</Typography>
              </Box>
            )}
            <RadioGroup
              value={profileVisibility}
              onChange={(e) => handleVisibilityChange(e.target.value as ProfileVisibility)}
            >
              <FormControlLabel
                value="PUBLIC"
                control={<Radio size="small" sx={{ '&.Mui-checked': { color: 'var(--color-primary-50)' } }} />}
                label={
                  <Box>
                    <Typography variant="body2" fontWeight={600} sx={{ color: C.text }}>
                      Public
                    </Typography>
                    <Typography variant="caption" sx={{ color: C.textMuted }}>
                      Anyone can see your name, Lightning address, company, stats, reviews, and COL-Points.
                    </Typography>
                  </Box>
                }
                sx={{ alignItems: 'flex-start', mb: 0.5 }}
              />
              <FormControlLabel
                value="PSEUDO_PRIVATE"
                control={<Radio size="small" sx={{ '&.Mui-checked': { color: 'var(--color-status-warning)' } }} />}
                label={
                  <Box>
                    <Typography variant="body2" fontWeight={600} sx={{ color: C.text }}>
                      Pseudo-Private
                    </Typography>
                    <Typography variant="caption" sx={{ color: C.textMuted }}>
                      Your name and company are hidden. Identity level, stats, reviews, and COL-Points remain visible.
                    </Typography>
                  </Box>
                }
                sx={{ alignItems: 'flex-start', mb: 0.5 }}
              />
              <FormControlLabel
                value="PRIVATE"
                control={<Radio size="small" sx={{ '&.Mui-checked': { color: 'var(--color-status-error)' } }} />}
                label={
                  <Box>
                    <Typography variant="body2" fontWeight={600} sx={{ color: C.text }}>
                      Private
                    </Typography>
                    <Typography variant="caption" sx={{ color: C.textMuted }}>
                      Only your identity level badge is visible. Everything else is hidden from other users.
                    </Typography>
                  </Box>
                }
                sx={{ alignItems: 'flex-start' }}
              />
            </RadioGroup>
          </Box>
        </Paper>
        <Snackbar
          open={snackbarOpen}
          autoHideDuration={3000}
          onClose={() => setSnackbarOpen(false)}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        >
          <Alert severity="success" onClose={() => setSnackbarOpen(false)} sx={{ width: '100%' }}>
            {snackbarMsg}
          </Alert>
        </Snackbar>
      </Box>

      <Box sx={{ mt: { xs: 3, md: 4, lg: 5 } }}>
        <SectionHeader title="Business Categories" subtitle="Assign categories to your profile so partners can find you in the Coop Partners filter" />
        <Paper variant="outlined" sx={{ borderRadius: 2, borderColor: C.border, bgcolor: C.surface }}>
          <Box sx={{ px: 2.5, py: 2 }}>
            {categoriesSaving && (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                <CircularProgress size={14} />
                <Typography variant="caption" sx={{ color: C.textMuted }}>Saving…</Typography>
              </Box>
            )}
            <CategoryMultiSelect
              value={categoryCodes}
              allCategories={allStandardCategories}
              loading={categoriesLoading}
              onChange={handleCategoriesChange}
            />
          </Box>
        </Paper>
      </Box>

      <PrivateTradeSettings />

      <Box sx={{ mt: { xs: 3, md: 4, lg: 5 } }}>
        <SectionHeader title="Category Navigation" subtitle="Control how categories behave in the marketplace. Applies to both sidebar and top panel." />
        <Paper variant="outlined" sx={{ borderRadius: 2, borderColor: C.border, bgcolor: C.surface }}>
          <List disablePadding>
            <ListItem sx={{ py: 1.75, px: 2.5 }}>
              <ListItemIcon sx={{ minWidth: 40 }}>
                <CategoryIcon sx={{ color: C.textMuted }} />
              </ListItemIcon>
              <ListItemText
                primary={<Typography variant="body2" fontWeight={600} sx={{ color: C.text }}>Hide empty categories</Typography>}
                secondary={
                  <Typography variant="caption" sx={{ color: C.textMuted }}>
                    Categories with 0 offers are hidden from the navigation panel.
                    This keeps the list focused on categories that have active listings.
                  </Typography>
                }
              />
              <ListItemSecondaryAction>
                <Switch
                  checked={hideEmptyCategories}
                  onChange={(e) => setHideEmptyCategories(e.target.checked)}
                  size="small"
                  sx={switchSx}
                />
              </ListItemSecondaryAction>
            </ListItem>
            <Divider component="li" sx={{ borderColor: C.border }} />
            <ListItem sx={{ py: 1.75, px: 2.5 }}>
              <ListItemIcon sx={{ minWidth: 40 }}>
                <StorefrontIcon sx={{ color: C.textMuted }} />
              </ListItemIcon>
              <ListItemText
                primary={<Typography variant="body2" fontWeight={600} sx={{ color: C.text }}>Show offer counts</Typography>}
                secondary={
                  <Typography variant="caption" sx={{ color: C.textMuted }}>
                    Displays the number of available offers next to each category name.
                    Disable for a more compact navigation view.
                  </Typography>
                }
              />
              <ListItemSecondaryAction>
                <Switch
                  checked={showOfferCounts}
                  onChange={(e) => setShowOfferCounts(e.target.checked)}
                  size="small"
                  sx={switchSx}
                />
              </ListItemSecondaryAction>
            </ListItem>
            <Divider component="li" sx={{ borderColor: C.border }} />
          </List>
        </Paper>
      </Box>

      <Box sx={{ mt: { xs: 3, md: 4, lg: 5 } }}>
        <SectionHeader title="Location" subtitle="Your default location for marketplace filtering" />
        <Paper variant="outlined" sx={{ borderRadius: 2, borderColor: C.border, bgcolor: C.surface }}>
          <Box sx={{ px: 2.5, py: 2, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <FormControl fullWidth size="small">
              <InputLabel>Country</InputLabel>
              <Select
                value={draftCountry}
                label="Country"
                onChange={(e) => setDraftCountry(e.target.value)}
                startAdornment={<LocationOnIcon sx={{ fontSize: 18, color: 'var(--theme-text-muted)', mr: 0.5 }} />}
              >
                <MenuItem value=""><em>None</em></MenuItem>
                {COUNTRY_OPTIONS.map(c => (
                  <MenuItem key={c.value} value={c.value}>{c.label}</MenuItem>
                ))}
              </Select>
            </FormControl>
            <TextField
              label="City"
              size="small"
              fullWidth
              value={draftCity}
              onChange={(e) => setDraftCity(e.target.value)}
              placeholder="e.g. Berlin"
              sx={{
                '& .MuiOutlinedInput-root': { borderRadius: 1 },
                '& .MuiInputLabel-root': { color: 'var(--theme-text-muted)' },
                '& .MuiOutlinedInput-input': { color: 'var(--theme-text)' },
              }}
            />
          </Box>
        </Paper>
      </Box>

      {locationDirty && (
        <Box sx={{ mt: 3, display: 'flex', justifyContent: 'flex-end' }}>
          <Box
            onClick={() => { setUserCity(draftCity); setUserCountry(draftCountry) }}
            sx={{
              px: 3,
              py: 1.5,
              borderRadius: 2,
              background: 'var(--color-primary-50)',
              color: 'white',
              cursor: 'pointer',
              fontWeight: 600,
              fontSize: '0.875rem',
              '&:hover': { background: 'var(--color-primary-40)' },
            }}
          >
            Save Settings
          </Box>
        </Box>
      )}

      <AccountDeletionSection />
    </Box>
  )
}

// ─── Private Trade Settings (ADR-152, Phase 4.1) ───────────────────────────────
// Default visibility for new offers/cooperations (read by useOfferForm.ts) +
// the user's NIP-10050 DM relay list (where peers publish Gift Wraps for us).
const DEFAULT_TRADE_MODE_KEY = 'colabonate:settings:defaultTradeMode'

function PrivateTradeSettings() {
  const [defaultMode, setDefaultMode] = useState<'PUBLIC' | 'PRIVATE'>(() => {
    try {
      return localStorage.getItem(DEFAULT_TRADE_MODE_KEY) === 'PRIVATE' ? 'PRIVATE' : 'PUBLIC'
    } catch { return 'PUBLIC' }
  })
  const [relays, setRelays] = useState<string[]>(() => getDmRelayList())
  const [draftRelays, setDraftRelays] = useState<string[]>(() => getDmRelayList())
  const [newRelay, setNewRelay] = useState('')
  const [publishing, setPublishing] = useState(false)
  const [snackbarOpen, setSnackbarOpen] = useState(false)
  const [snackbarMsg, setSnackbarMsg] = useState('')
  const [snackbarSeverity, setSnackbarSeverity] = useState<'success' | 'error'>('success')

  const relaysDirty = JSON.stringify(draftRelays) !== JSON.stringify(relays)

  function notify(severity: 'success' | 'error', msg: string) {
    setSnackbarSeverity(severity); setSnackbarMsg(msg); setSnackbarOpen(true)
  }

  function handleDefaultModeChange(mode: 'PUBLIC' | 'PRIVATE') {
    setDefaultMode(mode)
    try { localStorage.setItem(DEFAULT_TRADE_MODE_KEY, mode) } catch { /* ignore */ }
    notify('success', `Default trade mode set to ${mode === 'PUBLIC' ? 'Public' : 'Private'}`)
  }

  function handleAddRelay() {
    const url = newRelay.trim()
    if (!/^wss?:\/\/.+/.test(url)) { notify('error', 'Enter a valid relay URL (wss://…)'); return }
    if (draftRelays.includes(url)) { setNewRelay(''); return }
    setDraftRelays(prev => [...prev, url]); setNewRelay('')
  }

  function handleRemoveRelay(url: string) {
    setDraftRelays(prev => prev.filter(r => r !== url))
  }

  async function handlePublish() {
    if (draftRelays.length === 0) { notify('error', 'At least one DM relay is required'); return }
    setPublishing(true)
    try {
      // Persist locally first (works offline), then publish Kind 10050 to relays.
      setDmRelayListLocal(draftRelays)
      await publishDmRelayList(draftRelays)
      setRelays(draftRelays)
      notify('success', `DM relay list published (Kind 10050) — ${draftRelays.length} relay(s)`)
    } catch (e) {
      // Local list still saved; publish failed (relay/network). Inform the user.
      notify('error', `Saved locally, but publish failed: ${e instanceof Error ? e.message : 'unknown error'}`)
    } finally {
      setPublishing(false)
    }
  }

  const canPublish = relaysDirty && !publishing

  return (
    <Box sx={{ mt: { xs: 3, md: 4, lg: 5 } }}>
      <SectionHeader
        title="Private Trade"
        subtitle="Default visibility for new offers & cooperations, and your NIP-10050 DM relays"
      />

      {/* Default Trade Mode */}
      <Paper variant="outlined" sx={{ borderRadius: 2, borderColor: C.border, bgcolor: C.surface }}>
        <Box sx={{ px: 2.5, py: 2 }}>
          <Typography variant="body2" fontWeight={600} sx={{ color: C.text, mb: 0.5 }}>
            Default Trade Mode
          </Typography>
          <Typography variant="caption" sx={{ color: C.textMuted, display: 'block', mb: 1.5 }}>
            Pre-selected when you create a new offer or cooperation. You can still change it per trade.
          </Typography>
          <RadioGroup
            value={defaultMode}
            onChange={(e) => handleDefaultModeChange(e.target.value as 'PUBLIC' | 'PRIVATE')}
          >
            <FormControlLabel
              value="PUBLIC"
              control={<Radio size="small" sx={{ '&.Mui-checked': { color: 'var(--color-primary-50)' } }} />}
              label={
                <Box>
                  <Typography variant="body2" fontWeight={600} sx={{ color: C.text }}>Public</Typography>
                  <Typography variant="caption" sx={{ color: C.textMuted }}>
                    Published to the marketplace. Builds reputation (reviews, COL-Points).
                  </Typography>
                </Box>
              }
              sx={{ alignItems: 'flex-start', mb: 0.5 }}
            />
            <FormControlLabel
              value="PRIVATE"
              control={<Radio size="small" sx={{ '&.Mui-checked': { color: 'var(--color-status-warning)' } }} />}
              label={
                <Box>
                  <Typography variant="body2" fontWeight={600} sx={{ color: C.text }}>Private</Typography>
                  <Typography variant="caption" sx={{ color: C.textMuted }}>
                    Sent as NIP-17 encrypted DMs only. Not listed publicly. No reputation is built.
                  </Typography>
                </Box>
              }
              sx={{ alignItems: 'flex-start' }}
            />
          </RadioGroup>
          {defaultMode === 'PRIVATE' && (
            <Alert severity="info" icon={<LockOutlinedIcon fontSize="inherit" />} sx={{ mt: 1.5, bgcolor: 'transparent' }}>
              <Typography variant="caption">
                Private trades use isolated escrow wallets and mutual-arbiter dispute resolution. Reviews and COL-Points are disabled for private tickets.
              </Typography>
            </Alert>
          )}
        </Box>
      </Paper>

      {/* DM Relay List (NIP-10050) */}
      <Box sx={{ mt: { xs: 3, md: 4, lg: 5 } }}>
        <Paper variant="outlined" sx={{ borderRadius: 2, borderColor: C.border, bgcolor: C.surface }}>
          <Box sx={{ px: 2.5, py: 2 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
              <CloudSyncIcon sx={{ fontSize: 18, color: C.textMuted }} />
              <Typography variant="body2" fontWeight={600} sx={{ color: C.text }}>DM Relay List (NIP-10050)</Typography>
            </Box>
            <Typography variant="caption" sx={{ color: C.textMuted, display: 'block', mb: 1.5 }}>
              Relays where peers publish Gift-Wrapped DMs (private offers, cooperations, chat) for you.
            </Typography>

            <List disablePadding dense>
              {draftRelays.map(url => (
                <ListItem
                  key={url}
                  disableGutters
                  sx={{ py: 0.5 }}
                  secondaryAction={
                    <IconButton edge="end" size="small" onClick={() => handleRemoveRelay(url)} aria-label="Remove relay">
                      <DeleteOutlineIcon fontSize="small" />
                    </IconButton>
                  }
                >
                  <ListItemText
                    primary={<Typography variant="caption" sx={{ color: C.text, fontFamily: 'monospace' }}>{url}</Typography>}
                  />
                </ListItem>
              ))}
              {draftRelays.length === 0 && (
                <Typography variant="caption" sx={{ color: C.textMuted }}>No relays. Add at least one.</Typography>
              )}
            </List>

            <Box sx={{ display: 'flex', gap: 1, mt: 1.5, alignItems: 'flex-start' }}>
              <TextField
                size="small"
                fullWidth
                placeholder="wss://relay.damus.io"
                value={newRelay}
                onChange={(e) => setNewRelay(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddRelay() } }}
                sx={{ '& .MuiOutlinedInput-root': { borderRadius: 1 } }}
              />
              <IconButton
                onClick={handleAddRelay}
                size="small"
                sx={{ border: `1px solid ${C.border}`, borderRadius: 1, mt: 0.5 }}
                aria-label="Add relay"
              >
                <AddIcon fontSize="small" />
              </IconButton>
            </Box>

            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mt: 2 }}>
              <Typography
                variant="caption"
                onClick={() => setDraftRelays([...DEFAULT_DM_RELAYS])}
                sx={{ color: 'var(--color-primary-50)', cursor: 'pointer', '&:hover': { textDecoration: 'underline' } }}
              >
                Reset to defaults
              </Typography>
              <Box
                onClick={canPublish ? handlePublish : undefined}
                sx={{
                  display: 'flex', alignItems: 'center', gap: 1,
                  px: 2.5, py: 1, borderRadius: 2,
                  background: canPublish ? 'var(--color-primary-50)' : 'var(--theme-bg-subtle)',
                  color: canPublish ? 'white' : C.textMuted,
                  cursor: canPublish ? 'pointer' : 'default',
                  fontWeight: 600, fontSize: '0.8rem',
                  '&:hover': canPublish ? { background: 'var(--color-primary-40)' } : {},
                }}
              >
                {publishing && <CircularProgress size={13} color="inherit" />}
                {publishing ? 'Publishing…' : 'Save & Publish'}
              </Box>
            </Box>
          </Box>
        </Paper>
      </Box>

      <Snackbar
        open={snackbarOpen}
        autoHideDuration={3500}
        onClose={() => setSnackbarOpen(false)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity={snackbarSeverity} onClose={() => setSnackbarOpen(false)} sx={{ width: '100%' }}>
          {snackbarMsg}
        </Alert>
      </Snackbar>
    </Box>
  )
}

// ─── Company Settings Tab ──────────────────────────────────────────────────────
function CompanySettingsTab() {
  const [companyVisible, setCompanyVisible] = useState(true)
  const [catalogVisible, setCatalogVisible] = useState(true)
  const [productVisible, setProductVisible] = useState(true)
  const [serviceVisible, setServiceVisible] = useState(true)
  const [offerVisible, setOfferVisible] = useState(true)
  const [listingVisible, setListingVisible] = useState(true)

  return (
    <Box>
      <SectionHeader title="Company Settings" subtitle="Visibility for your company profile" />
      <Paper variant="outlined" sx={{ borderRadius: 2, borderColor: C.border, bgcolor: C.surface }}>
        <List disablePadding>
          <ListItem sx={{ py: 1.75, px: 2.5 }}>
            <ListItemIcon sx={{ minWidth: 40 }}>
              <StorefrontIcon sx={{ color: C.textMuted }} />
            </ListItemIcon>
            <ListItemText
              primary={<Typography variant="body2" fontWeight={600} sx={{ color: C.text }}>Visible in marketplace</Typography>}
              secondary={<Typography variant="caption" sx={{ color: C.textMuted }}>Your company appears in search results</Typography>}
            />
            <ListItemSecondaryAction>
              <Switch
                checked={companyVisible}
                onChange={(e) => setCompanyVisible(e.target.checked)}
                size="small"
              />
            </ListItemSecondaryAction>
          </ListItem>
          <Divider component="li" sx={{ borderColor: C.border }} />
        </List>
      </Paper>

      <Box sx={{ mt: { xs: 3, md: 4, lg: 5 } }}>
        <SectionHeader title="Catalog Settings" subtitle="Visibility for your product catalogs" />
        <Paper variant="outlined" sx={{ borderRadius: 2, borderColor: C.border, bgcolor: C.surface }}>
          <List disablePadding>
            <ListItem sx={{ py: 1.75, px: 2.5 }}>
              <ListItemIcon sx={{ minWidth: 40 }}>
                <CategoryIcon sx={{ color: C.textMuted }} />
              </ListItemIcon>
              <ListItemText
                primary={<Typography variant="body2" fontWeight={600} sx={{ color: C.text }}>Catalog visible</Typography>}
                secondary={<Typography variant="caption" sx={{ color: C.textMuted }}>Catalog appears in category listings</Typography>}
              />
              <ListItemSecondaryAction>
                <Switch
                  checked={catalogVisible}
                  onChange={(e) => setCatalogVisible(e.target.checked)}
                  size="small"
                />
              </ListItemSecondaryAction>
            </ListItem>
            <Divider component="li" sx={{ borderColor: C.border }} />
          </List>
        </Paper>
      </Box>

      <Box sx={{ mt: { xs: 3, md: 4, lg: 5 } }}>
        <SectionHeader title="Product Settings" subtitle="Default settings for new products" />
        <Paper variant="outlined" sx={{ borderRadius: 2, borderColor: C.border, bgcolor: C.surface }}>
          <List disablePadding>
            <ListItem sx={{ py: 1.75, px: 2.5 }}>
              <ListItemIcon sx={{ minWidth: 40 }}>
                <StorefrontIcon sx={{ color: C.textMuted }} />
              </ListItemIcon>
              <ListItemText
                primary={<Typography variant="body2" fontWeight={600} sx={{ color: C.text }}>Products visible by default</Typography>}
                secondary={<Typography variant="caption" sx={{ color: C.textMuted }}>New products appear in marketplace immediately</Typography>}
              />
              <ListItemSecondaryAction>
                <Switch
                  checked={productVisible}
                  onChange={(e) => setProductVisible(e.target.checked)}
                  size="small"
                />
              </ListItemSecondaryAction>
            </ListItem>
            <Divider component="li" sx={{ borderColor: C.border }} />
          </List>
        </Paper>
      </Box>

      <Box sx={{ mt: { xs: 3, md: 4, lg: 5 } }}>
        <SectionHeader title="Service Settings" subtitle="Default settings for new services" />
        <Paper variant="outlined" sx={{ borderRadius: 2, borderColor: C.border, bgcolor: C.surface }}>
          <List disablePadding>
            <ListItem sx={{ py: 1.75, px: 2.5 }}>
              <ListItemIcon sx={{ minWidth: 40 }}>
                <SettingsIcon sx={{ color: C.textMuted }} />
              </ListItemIcon>
              <ListItemText
                primary={<Typography variant="body2" fontWeight={600} sx={{ color: C.text }}>Services visible by default</Typography>}
                secondary={<Typography variant="caption" sx={{ color: C.textMuted }}>New services appear in marketplace immediately</Typography>}
              />
              <ListItemSecondaryAction>
                <Switch
                  checked={serviceVisible}
                  onChange={(e) => setServiceVisible(e.target.checked)}
                  size="small"
                />
              </ListItemSecondaryAction>
            </ListItem>
            <Divider component="li" sx={{ borderColor: C.border }} />
          </List>
        </Paper>
      </Box>

      <Box sx={{ mt: { xs: 3, md: 4, lg: 5 } }}>
        <SectionHeader title="Offer Settings" subtitle="Default settings for new offers" />
        <Paper variant="outlined" sx={{ borderRadius: 2, borderColor: C.border, bgcolor: C.surface }}>
          <List disablePadding>
            <ListItem sx={{ py: 1.75, px: 2.5 }}>
              <ListItemIcon sx={{ minWidth: 40 }}>
                <SettingsIcon sx={{ color: C.textMuted }} />
              </ListItemIcon>
              <ListItemText
                primary={<Typography variant="body2" fontWeight={600} sx={{ color: C.text }}>Offers visible by default</Typography>}
                secondary={<Typography variant="caption" sx={{ color: C.textMuted }}>New offers appear in marketplace immediately</Typography>}
              />
              <ListItemSecondaryAction>
                <Switch
                  checked={offerVisible}
                  onChange={(e) => setOfferVisible(e.target.checked)}
                  size="small"
                />
              </ListItemSecondaryAction>
            </ListItem>
            <Divider component="li" sx={{ borderColor: C.border }} />
          </List>
        </Paper>
      </Box>

      <Box sx={{ mt: { xs: 3, md: 4, lg: 5 } }}>
        <SectionHeader title="Listing Settings" subtitle="Default settings for new listings" />
        <Paper variant="outlined" sx={{ borderRadius: 2, borderColor: C.border, bgcolor: C.surface }}>
          <List disablePadding>
            <ListItem sx={{ py: 1.75, px: 2.5 }}>
              <ListItemIcon sx={{ minWidth: 40 }}>
                <SettingsIcon sx={{ color: C.textMuted }} />
              </ListItemIcon>
              <ListItemText
                primary={<Typography variant="body2" fontWeight={600} sx={{ color: C.text }}>Listings visible by default</Typography>}
                secondary={<Typography variant="caption" sx={{ color: C.textMuted }}>New listings appear in marketplace immediately</Typography>}
              />
              <ListItemSecondaryAction>
                <Switch
                  checked={listingVisible}
                  onChange={(e) => setListingVisible(e.target.checked)}
                  size="small"
                />
              </ListItemSecondaryAction>
            </ListItem>
            <Divider component="li" sx={{ borderColor: C.border }} />
          </List>
        </Paper>
      </Box>
    </Box>
  )
}

// ─── AI Assistant Settings Tab ─────────────────────────────────────────────────
interface OllamaModel {
  name: string;
  size?: number;
  modified_at?: string;
}

type AiProviderId = 'local' | 'openai' | 'adapter' | 'platform';

// ADR-281 D6 — masked view of the user's server-side config (never carries the key).
interface UserAiConfigView {
  provider: AiProviderId;
  baseUrl: string | null;
  model: string | null;
  hasApiKey: boolean;
  adapterId: string | null;
  runtime: string | null;
  adapterArgs: string[] | null;
  keyEncryptionAvailable: boolean;
  operatorDefaults: { baseUrl: string | null; model: string | null };
  updatedAt: string | null;
}

// ADR-281 D5 — capability report from the mcp-server (GET /ai/config).
interface AiCapabilities {
  modes: Array<{ id: AiProviderId; enabled: boolean; label: string; supportsImages: boolean }>;
  adapters: Array<{ id: string; label: string; description: string; available: boolean; version?: string | null; hint: string; resolvedPath?: string | null }>;
  runtime: string;
}

function AISettingsTab() {
  const [aiEnabled, setAiEnabled] = usePref('aiAssistantEnabled', true)
  const [showToolActivity, setShowToolActivity] = usePref('aiShowToolActivity', true)
  const [snackbarOpen, setSnackbarOpen] = useState(false)
  const [snackbarMsg, setSnackbarMsg] = useState('')

  // Model & System Prompt
  const [model, setModel] = useState(() => localStorage.getItem('aiModel') || import.meta.env.VITE_OLLAMA_DEFAULT_MODEL || 'qwen2.5:7b-instruct-q4_K_M')
  // The core platform/tool-routing/formatting instructions live server-side
  // in apps/mcp-server/src/adapter/system-prompt.ts (single source of truth
  // for all three provider modes). This field is additive user preferences
  // only — sent as `customInstructions` and appended after the server's own
  // rules, which it cannot override (see buildSystemPrompt).
  const DEFAULT_CUSTOM_INSTRUCTIONS = ''

  const [customInstructions, setCustomInstructions] = useState(() => localStorage.getItem('aiSystemPrompt') ?? DEFAULT_CUSTOM_INSTRUCTIONS)
  const [ollamaModels, setOllamaModels] = useState<OllamaModel[]>([])
  const [modelsLoading, setModelsLoading] = useState(false)

  // Ollama Parameters
  const [temperature, setTemperature] = useState(() => localStorage.getItem('aiTemperature') || import.meta.env.VITE_OLLAMA_TEMPERATURE || '0.7')
  const [topP, setTopP] = useState(() => localStorage.getItem('aiTopP') || import.meta.env.VITE_OLLAMA_TOP_P || '0.9')
  const [topK, setTopK] = useState(() => localStorage.getItem('aiTopK') || import.meta.env.VITE_OLLAMA_TOP_K || '40')
  const [numCtx, setNumCtx] = useState(() => localStorage.getItem('aiNumCtx') || import.meta.env.VITE_OLLAMA_NUM_CTX || '4096')
  const [repeatPenalty, setRepeatPenalty] = useState(() => localStorage.getItem('aiRepeatPenalty') || import.meta.env.VITE_OLLAMA_REPEAT_PENALTY || '1.1')
  const [seed, setSeed] = useState(() => localStorage.getItem('aiSeed') || import.meta.env.VITE_OLLAMA_SEED || '')
  const [frequencyPenalty, setFrequencyPenalty] = useState(() => localStorage.getItem('aiFrequencyPenalty') || import.meta.env.VITE_OLLAMA_FREQUENCY_PENALTY || '0')
  const [presencePenalty, setPresencePenalty] = useState(() => localStorage.getItem('aiPresencePenalty') || import.meta.env.VITE_OLLAMA_PRESENCE_PENALTY || '0')

  const [showAdvanced, setShowAdvanced] = useState(false)

  // ADR-281 D6 — provider selection (local / OpenAI-compatible / CLI adapter).
  const [provider, setProvider] = useState<AiProviderId>(() => (localStorage.getItem('aiProvider') as AiProviderId) || 'openai')
  const [aiConfig, setAiConfig] = useState<UserAiConfigView | null>(null)
  const [capabilities, setCapabilities] = useState<AiCapabilities | null>(null)
  const [openaiBaseUrl, setOpenaiBaseUrl] = useState('')
  const [openaiModel, setOpenaiModel] = useState('')
  const [openaiApiKey, setOpenaiApiKey] = useState('')
  const [adapterId, setAdapterId] = useState('')
  // FU-292 (scoped) — extra CLI flags for the selected adapter's own fixed
  // binary, one per line; no new binary names, server validates + resolves
  // via the same allowlisted registry (registry.ts).
  const [adapterArgsText, setAdapterArgsText] = useState('')
  const [testState, setTestState] = useState<'idle' | 'testing' | 'ok' | 'fail'>('idle')
  const [testMessage, setTestMessage] = useState('')
  const [saving, setSaving] = useState(false)
  // FU-286 — model catalog fetched from the provider's /models on a successful test.
  const [availableModels, setAvailableModels] = useState<string[]>([])
  // FU-287 — confirmation before removing the stored key.
  const [removeKeyDialogOpen, setRemoveKeyDialogOpen] = useState(false)

  // Load the masked server-side config + the mcp-server capability report.
  useEffect(() => {
    apiCall('/api/ai/config')
      .then(r => r.json())
      .then((d: UserAiConfigView) => {
        setAiConfig(d)
        setProvider((localStorage.getItem('aiProvider') as AiProviderId) || d.provider)
        setOpenaiBaseUrl(d.baseUrl ?? d.operatorDefaults.baseUrl ?? '')
        setOpenaiModel(d.model ?? '')
        setAdapterArgsText(Array.isArray(d.adapterArgs) ? d.adapterArgs.join('\n') : '')
      })
      .catch(() => {})
    fetch('/ai/config')
      .then(r => r.json())
      .then((d: AiCapabilities) => setCapabilities(d))
      .catch(() => {})
  }, [])

  // Fetch available models from Ollama
  useEffect(() => {
    setModelsLoading(true)
    fetch('/ollama/api/tags')
      .then(r => r.json())
      .then(data => {
        if (data.models) {
          const chatModels = data.models.filter(
            (m: OllamaModel) => !m.name.includes('embed') && !m.name.includes('ocr'),
          )
          setOllamaModels(chatModels)
          const savedModel = localStorage.getItem('aiModel')
          if (!savedModel && chatModels.length > 0) {
            setModel(chatModels[0].name)
          }
        }
      })
      .catch(() => {
        setOllamaModels([{ name: import.meta.env.VITE_OLLAMA_DEFAULT_MODEL || 'qwen2.5:7b-instruct-q4_K_M', size: 4.7e9 }])
      })
      .finally(() => setModelsLoading(false))
  }, [])

  const handleClearHistory = () => {
    localStorage.setItem('aiChatCleared', Date.now().toString())
    setSnackbarMsg('Chat history will be cleared on next open')
    setSnackbarOpen(true)
  }

  const handleSave = async () => {
    localStorage.setItem('aiModel', model)
    localStorage.setItem('aiSystemPrompt', customInstructions)
    localStorage.setItem('aiTemperature', temperature)
    localStorage.setItem('aiTopP', topP)
    localStorage.setItem('aiTopK', topK)
    localStorage.setItem('aiNumCtx', numCtx)
    localStorage.setItem('aiRepeatPenalty', repeatPenalty)
    if (seed) localStorage.setItem('aiSeed', seed)
    else localStorage.removeItem('aiSeed')
    localStorage.setItem('aiFrequencyPenalty', frequencyPenalty)
    localStorage.setItem('aiPresencePenalty', presencePenalty)

    // ADR-281 D3/D6 — persist the provider selection server-side. The OpenAI
    // API key goes to the backend encrypted at rest; it never lives in
    // localStorage (FU-195-C).
    localStorage.setItem('aiProvider', provider)
    setSaving(true)
    try {
      const body: Record<string, unknown> = { provider }
      if (provider === 'openai') {
        body.baseUrl = openaiBaseUrl.trim() || undefined
        body.model = openaiModel.trim() || undefined
        if (openaiApiKey) body.apiKey = openaiApiKey
      }
      if (provider === 'adapter') {
        body.adapterId = adapterId || undefined
        const extraArgs = adapterArgsText.split('\n').map((s) => s.trim()).filter(Boolean)
        body.adapterArgs = extraArgs.length > 0 ? extraArgs : undefined
      }
      const res = await apiCall('/api/ai/config', { method: 'PUT', body: JSON.stringify(body) })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setSnackbarMsg(`Save failed: ${data.message ?? res.status}`)
        setSnackbarOpen(true)
        return
      }
      const updated = await apiCall('/api/ai/config').then(r => r.json())
      setAiConfig(updated)
      const hasStoredKey = updated.hasApiKey === true
      if (hasStoredKey && openaiApiKey) setOpenaiApiKey('')
      setSnackbarMsg('Settings saved')
      setSnackbarOpen(true)
    } catch {
      setSnackbarMsg('Save failed — network error')
      setSnackbarOpen(true)
    } finally {
      setSaving(false)
    }
  }

  const testProviderConnection = async () => {
    if (!openaiBaseUrl.trim() || (!openaiApiKey && !aiConfig?.hasApiKey)) {
      setTestState('fail')
      setTestMessage('Enter the API key to run the connection test.')
      return
    }
    setTestState('testing')
    setTestMessage('')
    try {
      const res = await apiCall('/api/ai/config/test', {
        method: 'POST',
        body: JSON.stringify({
          baseUrl: openaiBaseUrl.trim(),
          apiKey: openaiApiKey || undefined,
          model: openaiModel.trim() || undefined,
        }),
      })
      const data = await res.json()
      if (data.ok) {
        setTestState('ok')
        setTestMessage(
          Array.isArray(data.models) && data.models.length > 0
            ? `Connection OK — provider reachable. ${data.models.length} model${data.models.length === 1 ? '' : 's'} found.`
            : 'Connection OK — provider reachable.',
        )
        setAvailableModels(Array.isArray(data.models) ? data.models : [])
      } else {
        setTestState('fail')
        setTestMessage(data.error ?? 'Connection failed.')
        setAvailableModels([])
      }
    } catch {
      setTestState('fail')
      setTestMessage('Connection failed — network error.')
      setAvailableModels([])
    }
  }

  const handleRemoveStoredKey = async () => {
    try {
      await apiCall('/api/ai/config', {
        method: 'PUT',
        body: JSON.stringify({ provider, baseUrl: openaiBaseUrl.trim() || undefined, model: openaiModel.trim() || undefined, clearKey: true }),
      })
      setAiConfig(prev => prev ? { ...prev, hasApiKey: false } : prev)
      setSnackbarMsg('Stored API key removed')
      setSnackbarOpen(true)
    } catch {
      setSnackbarMsg('Could not remove the stored key')
      setSnackbarOpen(true)
    }
  }

  const handleResetCustomInstructions = () => {
    setCustomInstructions(DEFAULT_CUSTOM_INSTRUCTIONS)
  }

  const switchSx = {
    '& .MuiSwitch-switchBase.Mui-checked': { color: 'var(--color-primary-50)' },
    '& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track': { backgroundColor: 'var(--color-primary-50)' },
    '& .MuiSwitch-track': { borderRadius: 13 },
    '& .MuiSwitch-thumb': { boxShadow: '0 1px 3px rgba(0,0,0,0.2)' },
  }

  const formatSize = (bytes?: number) => {
    if (!bytes) return ''
    const gb = bytes / 1e9
    if (gb >= 1) return `${gb.toFixed(1)} GB`
    const mb = bytes / 1e6
    if (mb >= 1) return `${mb.toFixed(0)} MB`
    return `${(bytes / 1e3).toFixed(0)} KB`
  }

  return (
    <Box>
      <SectionHeader title="AI Assistant" subtitle="Configure your in-app AI assistant behavior" />
      <Paper variant="outlined" sx={{ borderRadius: 2, borderColor: C.border, bgcolor: C.surface }}>
        <List disablePadding>
          <ListItem sx={{ py: 1.75, px: 2.5 }}>
            <ListItemIcon sx={{ minWidth: 40 }}>
              <SmartToyIcon sx={{ color: C.textMuted }} />
            </ListItemIcon>
            <ListItemText
              primary={<Typography variant="body2" fontWeight={600} sx={{ color: C.text }}>Enable AI Assistant</Typography>}
              secondary={<Typography variant="caption" sx={{ color: C.textMuted }}>Show the floating assistant button in the bottom-right corner</Typography>}
            />
            <ListItemSecondaryAction>
              <Switch
                checked={aiEnabled}
                onChange={(e) => setAiEnabled(e.target.checked)}
                size="small"
                sx={switchSx}
              />
            </ListItemSecondaryAction>
          </ListItem>
          <Divider component="li" sx={{ borderColor: C.border }} />
          <ListItem sx={{ py: 1.75, px: 2.5 }}>
            <ListItemIcon sx={{ minWidth: 40 }}>
              <SmartToyIcon sx={{ color: C.textMuted }} />
            </ListItemIcon>
            <ListItemText
              primary={<Typography variant="body2" fontWeight={600} sx={{ color: C.text }}>Show tool activity</Typography>}
              secondary={<Typography variant="caption" sx={{ color: C.textMuted }}>Display spinner and label when AI is calling tools</Typography>}
            />
            <ListItemSecondaryAction>
              <Switch
                checked={showToolActivity}
                onChange={(e) => setShowToolActivity(e.target.checked)}
                size="small"
                sx={switchSx}
              />
            </ListItemSecondaryAction>
          </ListItem>
          <Divider component="li" sx={{ borderColor: C.border }} />
          <ListItem sx={{ py: 1.75, px: 2.5 }}>
            <ListItemIcon sx={{ minWidth: 40 }}>
              <DeleteOutlineIcon sx={{ color: C.textMuted }} />
            </ListItemIcon>
            <ListItemText
              primary={<Typography variant="body2" fontWeight={600} sx={{ color: C.text }}>Clear chat history</Typography>}
              secondary={<Typography variant="caption" sx={{ color: C.textMuted }}>Session-only: history is cleared on page refresh</Typography>}
            />
            <ListItemSecondaryAction>
              <Switch
                checked={false}
                onChange={handleClearHistory}
                size="small"
                sx={switchSx}
              />
            </ListItemSecondaryAction>
          </ListItem>
          <Divider component="li" sx={{ borderColor: C.border }} />
        </List>
      </Paper>

      {/* ADR-281 D6 — provider selection */}
      <Box sx={{ mt: { xs: 3, md: 4, lg: 5 } }}>
        <SectionHeader title="Provider" subtitle="Where the AI assistant runs its model" />
        <Paper variant="outlined" sx={{ borderRadius: 2, borderColor: C.border, bgcolor: C.surface }}>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr', lg: 'repeat(4, 1fr)' }, gap: 1.5, p: 2 }}>
            {([
              {
                id: 'platform' as const,
                title: 'Colabonate Hosted',
                desc: 'No setup, Colabonate runs the model. Pay per pack of requests, directly over Lightning; credits never expire.',
                icon: <BoltIcon sx={{ fontSize: 20 }} />,
              },
              {
                id: 'local' as const,
                title: 'Local (Ollama)',
                desc: 'Fully private — the model runs on this platform via its local Ollama instance.',
                icon: <StorageIcon sx={{ fontSize: 20 }} />,
              },
              {
                id: 'openai' as const,
                title: 'OpenAI-compatible',
                desc: 'Any OpenAI-compatible provider (OpenAI, Groq, LM Studio…). The API key is stored encrypted server-side.',
                icon: <CloudSyncIcon sx={{ fontSize: 20 }} />,
              },
              {
                id: 'adapter' as const,
                title: 'CLI Agent',
                desc: 'Drive an installed CLI agent (OpenCode, Pi Agent, Hermes) as the assistant. Text-only; one request = one agent run.',
                icon: <TerminalIcon sx={{ fontSize: 20 }} />,
              },
            ]).map(mode => (
              <Box
                key={mode.id}
                onClick={() => setProvider(mode.id)}
                sx={{
                  p: 1.5,
                  borderRadius: 1.5,
                  border: '1px solid',
                  borderColor: provider === mode.id ? 'var(--color-primary-50)' : C.border,
                  bgcolor: provider === mode.id ? 'var(--color-primary-8)' : 'var(--theme-bg-subtle)',
                  cursor: 'pointer',
                  transition: 'border-color 150ms ease',
                }}
              >
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Box sx={{ color: provider === mode.id ? 'var(--color-primary-50)' : C.textMuted, display: 'flex' }}>{mode.icon}</Box>
                  <Typography variant="body2" fontWeight={600} sx={{ color: C.text }}>{mode.title}</Typography>
                  <Box sx={{ ml: 'auto', width: 14, height: 14, borderRadius: '50%', border: '1.5px solid', borderColor: provider === mode.id ? 'var(--color-primary-50)' : C.border, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {provider === mode.id && <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: 'var(--color-primary-50)' }} />}
                  </Box>
                </Box>
                <Typography variant="caption" sx={{ color: C.textMuted, mt: 0.75, display: 'block', lineHeight: 1.45 }}>{mode.desc}</Typography>
              </Box>
            ))}
          </Box>

          {provider === 'platform' && <Divider sx={{ borderColor: C.border }} />}
          {provider === 'platform' && (
            <Box sx={{ px: 2.5, py: 2, display: 'grid', gap: 1.5 }}>
              {capabilities?.modes.find(m => m.id === 'platform')?.enabled === false && (
                <Typography variant="caption" sx={{ color: 'var(--color-status-warning)', lineHeight: 1.5 }}>
                  Colabonate-hosted AI is not switched on for this deployment yet.
                </Typography>
              )}
              <AiCreditsPanel />
            </Box>
          )}

          {provider === 'openai' && <Divider sx={{ borderColor: C.border }} />}
          {provider === 'openai' && (
            <Box sx={{ px: 2.5, py: 2, display: 'grid', gap: 1.75 }}>
              {/* ADR-409 D8: the base URL field shares the agent wizard's
                  provider catalog (assistant convention: root + /v1). Free
                  text stays allowed — the presets are only a vocabulary. */}
              <Autocomplete
                freeSolo
                options={assistantBaseUrlPresets().map((p) => p.baseUrl)}
                getOptionLabel={(option: string) => option}
                value={openaiBaseUrl}
                onChange={(_, value) => { setOpenaiBaseUrl(value ?? ''); setAvailableModels([]); setTestState('idle') }}
                onInputChange={(_, value) => { setOpenaiBaseUrl(value); setAvailableModels([]); setTestState('idle') }}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    size="small"
                    label="Base URL"
                    placeholder={aiConfig?.operatorDefaults.baseUrl ?? 'https://api.openai.com/v1'}
                    helperText="OpenAI-compatible endpoint — https only, no local/private addresses. Presets: OpenAI, DeepSeek, Groq, OpenRouter, … (same catalog as the agent wizard)"
                  />
                )}
              />
              <TextField
                size="small"
                label="API Key"
                type="password"
                value={openaiApiKey}
                onChange={(e) => { setOpenaiApiKey(e.target.value); setAvailableModels([]); setTestState('idle') }}
                placeholder={aiConfig?.hasApiKey ? '•••••••• (stored — leave empty to keep)' : 'sk-…'}
                helperText={
                  aiConfig?.hasApiKey
                    ? `Key stored encrypted on the server${aiConfig.updatedAt ? ` · saved ${new Date(aiConfig.updatedAt).toLocaleDateString()}` : ''}. Enter a new one to replace it, or remove it below.`
                    : aiConfig?.keyEncryptionAvailable
                      ? 'Stored encrypted at rest; never kept in this browser.'
                      : 'Warning: this server has no AI key encryption secret — saving a key will fail.'
                }
              />
              {aiConfig?.hasApiKey && (
                <Box>
                  <Typography
                    variant="caption"
                    onClick={() => setRemoveKeyDialogOpen(true)}
                    sx={{ color: 'var(--color-status-warning)', cursor: 'pointer', '&:hover': { textDecoration: 'underline' } }}
                  >
                    Remove stored key
                  </Typography>
                </Box>
              )}
              <FormControl fullWidth size="small">
                <Autocomplete
                  freeSolo
                  size="small"
                  options={availableModels}
                  value={openaiModel}
                  onInputChange={(_e, value) => setOpenaiModel(value)}
                  renderInput={(params) => (
                    <TextField
                      {...params}
                      label="Model"
                      placeholder={aiConfig?.operatorDefaults.model ?? 'gpt-4o-mini'}
                      helperText={
                        availableModels.length > 0
                          ? `${availableModels.length} model${availableModels.length === 1 ? '' : 's'} from this provider — pick one or type your own. Leave empty for the platform default.`
                          : 'Leave empty to use the platform default. Run "Test connection" to load this provider’s model list.'
                      }
                    />
                  )}
                />
              </FormControl>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                <Box
                  onClick={testProviderConnection}
                  sx={{
                    px: 2,
                    py: 1,
                    borderRadius: 1.5,
                    border: '1px solid',
                    borderColor: C.border,
                    color: C.text,
                    cursor: 'pointer',
                    fontSize: '0.8125rem',
                    fontWeight: 600,
                    '&:hover': { borderColor: 'var(--color-primary-50)', color: 'var(--color-primary-50)' },
                  }}
                >
                  {testState === 'testing' ? 'Testing…' : 'Test connection'}
                </Box>
                {testState === 'ok' && <Typography variant="caption" sx={{ color: 'var(--color-status-success)' }}>{testMessage}</Typography>}
                {testState === 'fail' && <Typography variant="caption" sx={{ color: 'var(--color-status-error)' }}>{testMessage}</Typography>}
              </Box>
            </Box>
          )}

          {provider === 'adapter' && <Divider sx={{ borderColor: C.border }} />}
          {provider === 'adapter' && (
            <Box sx={{ px: 2.5, py: 2 }}>
              <Typography variant="caption" sx={{ color: C.textMuted, mb: 1.5, display: 'block', lineHeight: 1.5 }}>
                CLI agents run on the server from your message — they never use entity cards or tool widgets (v1 is text-only), each request is one agent run with a 120&nbsp;s timeout.
              </Typography>
              {!capabilities ? (
                <Typography variant="caption" sx={{ color: C.textMuted }}>Checking availability…</Typography>
              ) : capabilities.modes.find(m => m.id === 'adapter')?.enabled === false ? (
                <Typography variant="caption" sx={{ color: 'var(--color-status-warning)' }}>CLI adapter mode is disabled on this deployment.</Typography>
              ) : (
                <RadioGroup
                  value={adapterId || capabilities.adapters.find(a => a.available)?.id || ''}
                  onChange={(e) => setAdapterId(e.target.value)}
                >
                  {capabilities.adapters.map(a => (
                    <FormControlLabel
                      key={a.id}
                      value={a.id}
                      control={<Radio size="small" />}
                      label={
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <Typography variant="body2" sx={{ color: C.text }}>{a.label}</Typography>
                          <Typography variant="caption" sx={{ color: a.available ? 'var(--color-status-success)' : C.textMuted }}>
                            {a.available ? (a.version ? `available · ${a.version}` : 'available') : 'not installed'}
                          </Typography>
                          <Typography variant="caption" sx={{ color: C.textMuted }}>{a.hint}</Typography>
                          {a.resolvedPath && (
                            <Typography variant="caption" sx={{ color: C.textMuted, fontFamily: 'monospace', fontSize: '0.6875rem' }}>{a.resolvedPath}</Typography>
                          )}
                        </Box>
                      }
                    />
                  ))}
                </RadioGroup>
              )}
              <TextField
                size="small"
                fullWidth
                multiline
                minRows={2}
                sx={{ mt: 2 }}
                label="Extra CLI flags (optional)"
                value={adapterArgsText}
                onChange={(e) => setAdapterArgsText(e.target.value)}
                placeholder={'--verbose\n--model claude-sonnet-5'}
                helperText="One flag per line. Passed to the selected agent's own command — never a new binary, up to 8 flags."
              />
            </Box>
          )}
        </Paper>
      </Box>

      {provider === 'local' && (
        <Box sx={{ mt: { xs: 3, md: 4, lg: 5 } }}>
          <SectionHeader title="Model Selection" subtitle="Choose the Ollama model for AI assistant" />
        <Paper variant="outlined" sx={{ borderRadius: 2, borderColor: C.border, bgcolor: C.surface }}>
          <Box sx={{ px: 2.5, py: 2 }}>
            <Typography variant="caption" sx={{ color: C.textMuted, mb: 1, display: 'block' }}>
              Pull new models with <code>docker exec ollama ollama pull modelname</code>. Refresh to see updates.
            </Typography>
            <FormControl fullWidth size="small" disabled={modelsLoading}>
              <InputLabel id="model-select-label">Model</InputLabel>
              <Select
                labelId="model-select-label"
                id="model-select"
                value={model}
                label="Model"
                onChange={(e) => setModel(e.target.value)}
                sx={{
                  '& .MuiOutlinedInput-notchedOutline': { borderColor: C.border },
                  '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: 'var(--color-primary-40)' },
                  '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: 'var(--color-primary-50)' },
                }}
              >
                {ollamaModels.length === 0 && !modelsLoading && (
                  <MenuItem value="" disabled>
                    <Typography variant="caption" sx={{ color: C.textMuted }}>
                      No models found. Is Ollama running?
                    </Typography>
                  </MenuItem>
                )}
                {ollamaModels.map(m => (
                  <MenuItem key={m.name} value={m.name}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center' }}>
                      <Typography variant="body2">{m.name}</Typography>
                      {m.size && (
                        <Typography variant="caption" sx={{ color: C.textMuted, ml: 2 }}>
                          {formatSize(m.size)}
                        </Typography>
                      )}
                    </Box>
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            {modelsLoading && (
              <Typography variant="caption" sx={{ color: C.textMuted, mt: 0.5, display: 'block' }}>
                Loading models from Ollama...
              </Typography>
            )}
          </Box>
        </Paper>
      </Box>
      )}

      <Box sx={{ mt: { xs: 3, md: 4, lg: 5 } }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
          <Box>
            <SectionHeader title="Custom Instructions" subtitle="Additional preferences for the assistant (tone, focus, language) — applies in every mode" />
          </Box>
          <Typography
            variant="caption"
            onClick={handleResetCustomInstructions}
            sx={{
              color: 'var(--color-primary-50)',
              cursor: 'pointer',
              '&:hover': { textDecoration: 'underline' },
            }}
          >
            Clear
          </Typography>
        </Box>
        <Paper variant="outlined" sx={{ borderRadius: 2, borderColor: C.border, bgcolor: C.surface }}>
          <Box sx={{ p: 2 }}>
            <Typography variant="caption" sx={{ color: C.textMuted, mb: 1, display: 'block' }}>
              These are appended to Colabonate's built-in assistant instructions — they customize style and focus but cannot override platform rules (deduplication, ID handling, publishing behavior). In CLI Adapter mode, the assistant has no access to Colabonate's own tools (offers, cooperations, tickets, DAO) — only its own built-in tools.
            </Typography>
            <Box component="textarea"
              value={customInstructions}
              onChange={(e) => setCustomInstructions(e.target.value)}
              placeholder="e.g. Always answer in German. Prefer concise bullet points. Focus on B2B use cases."
              sx={{
                width: '100%',
                minHeight: 200,
                p: 1.5,
                borderRadius: 1,
                border: `1px solid ${C.border}`,
                background: 'var(--theme-bg)',
                color: C.text,
                fontFamily: 'monospace',
                fontSize: '0.8125rem',
                resize: 'vertical',
                outline: 'none',
                '&:focus': { borderColor: 'var(--color-primary-50)' },
              }}
            />
          </Box>
        </Paper>
      </Box>

      {provider === 'local' && (
      <Box sx={{ mt: { xs: 3, md: 4, lg: 5 } }}>
        <Box
          onClick={() => setShowAdvanced(!showAdvanced)}
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            cursor: 'pointer',
            mb: 1,
          }}
        >
          <SectionHeader title="Model Parameters" subtitle="Fine-tune generation behavior" />
          <Typography variant="caption" sx={{ color: 'var(--color-primary-50)' }}>
            {showAdvanced ? 'Hide' : 'Show'}
          </Typography>
        </Box>
      </Box>
      )}

      {provider === 'local' && showAdvanced && (
        <Paper variant="outlined" sx={{ borderRadius: 2, borderColor: C.border, bgcolor: C.surface }}>
          <Box sx={{ p: 2.5 }}>
            <Typography variant="caption" sx={{ color: C.textMuted, mb: 2, display: 'block' }}>
              These parameters control how the model generates responses. Adjust carefully — wrong values can degrade quality.
            </Typography>

            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2 }}>
              <Box>
                <Typography variant="caption" sx={{ color: C.textMuted, mb: 0.5, display: 'block' }}>
                  Temperature <Typography component="span" sx={{ color: 'var(--color-primary-50)' }}>{temperature}</Typography>
                </Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Typography variant="caption" sx={{ color: C.textMuted, minWidth: 30 }}>0</Typography>
                  <input
                    type="range"
                    min="0"
                    max="2"
                    step="0.05"
                    value={temperature}
                    onChange={(e) => setTemperature(e.target.value)}
                    style={{ flex: 1, accentColor: 'var(--color-primary-50)' }}
                  />
                  <Typography variant="caption" sx={{ color: C.textMuted, minWidth: 30 }}>2</Typography>
                </Box>
                <Typography variant="caption" sx={{ color: C.textMuted, fontSize: '0.7rem' }}>
                  Lower = deterministic, Higher = creative
                </Typography>
              </Box>

              <Box>
                <Typography variant="caption" sx={{ color: C.textMuted, mb: 0.5, display: 'block' }}>
                  Top P <Typography component="span" sx={{ color: 'var(--color-primary-50)' }}>{topP}</Typography>
                </Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Typography variant="caption" sx={{ color: C.textMuted, minWidth: 30 }}>0</Typography>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={topP}
                    onChange={(e) => setTopP(e.target.value)}
                    style={{ flex: 1, accentColor: 'var(--color-primary-50)' }}
                  />
                  <Typography variant="caption" sx={{ color: C.textMuted, minWidth: 30 }}>1</Typography>
                </Box>
                <Typography variant="caption" sx={{ color: C.textMuted, fontSize: '0.7rem' }}>
                  Nucleus sampling threshold
                </Typography>
              </Box>

              <Box>
                <Typography variant="caption" sx={{ color: C.textMuted, mb: 0.5, display: 'block' }}>
                  Top K <Typography component="span" sx={{ color: 'var(--color-primary-50)' }}>{topK}</Typography>
                </Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Typography variant="caption" sx={{ color: C.textMuted, minWidth: 30 }}>1</Typography>
                  <input
                    type="range"
                    min="1"
                    max="100"
                    step="1"
                    value={topK}
                    onChange={(e) => setTopK(e.target.value)}
                    style={{ flex: 1, accentColor: 'var(--color-primary-50)' }}
                  />
                  <Typography variant="caption" sx={{ color: C.textMuted, minWidth: 30 }}>100</Typography>
                </Box>
                <Typography variant="caption" sx={{ color: C.textMuted, fontSize: '0.7rem' }}>
                  Limit vocabulary to top K tokens
                </Typography>
              </Box>

              <Box>
                <Typography variant="caption" sx={{ color: C.textMuted, mb: 0.5, display: 'block' }}>
                  Repeat Penalty <Typography component="span" sx={{ color: 'var(--color-primary-50)' }}>{repeatPenalty}</Typography>
                </Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Typography variant="caption" sx={{ color: C.textMuted, minWidth: 30 }}>1</Typography>
                  <input
                    type="range"
                    min="1"
                    max="2"
                    step="0.05"
                    value={repeatPenalty}
                    onChange={(e) => setRepeatPenalty(e.target.value)}
                    style={{ flex: 1, accentColor: 'var(--color-primary-50)' }}
                  />
                  <Typography variant="caption" sx={{ color: C.textMuted, minWidth: 30 }}>2</Typography>
                </Box>
                <Typography variant="caption" sx={{ color: C.textMuted, fontSize: '0.7rem' }}>
                  Penalize repetition (1.0 = off)
                </Typography>
              </Box>

              <Box>
                <Typography variant="caption" sx={{ color: C.textMuted, mb: 0.5, display: 'block' }}>
                  Context Window <Typography component="span" sx={{ color: 'var(--color-primary-50)' }}>{numCtx}</Typography>
                </Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Typography variant="caption" sx={{ color: C.textMuted, minWidth: 30 }}>512</Typography>
                  <input
                    type="range"
                    min="512"
                    max="131072"
                    step="512"
                    value={numCtx}
                    onChange={(e) => setNumCtx(e.target.value)}
                    style={{ flex: 1, accentColor: 'var(--color-primary-50)' }}
                  />
                  <Typography variant="caption" sx={{ color: C.textMuted, minWidth: 30 }}>131k</Typography>
                </Box>
                <Typography variant="caption" sx={{ color: C.textMuted, fontSize: '0.7rem' }}>
                  Max tokens in context
                </Typography>
              </Box>

              <Box>
                <Typography variant="caption" sx={{ color: C.textMuted, mb: 0.5, display: 'block' }}>
                  Seed <Typography component="span" sx={{ color: 'var(--color-primary-50)' }}>{seed || 'random'}</Typography>
                </Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Typography variant="caption" sx={{ color: C.textMuted, minWidth: 30 }}>0</Typography>
                  <input
                    type="range"
                    min="0"
                    max="2147483647"
                    step="1"
                    value={seed || '0'}
                    onChange={(e) => setSeed(e.target.value)}
                    style={{ flex: 1, accentColor: 'var(--color-primary-50)' }}
                  />
                  <Typography variant="caption" sx={{ color: C.textMuted, minWidth: 30 }}>2B</Typography>
                </Box>
                <Typography variant="caption" sx={{ color: C.textMuted, fontSize: '0.7rem' }}>
                  Fixed seed for reproducibility
                </Typography>
              </Box>

              <Box>
                <Typography variant="caption" sx={{ color: C.textMuted, mb: 0.5, display: 'block' }}>
                  Frequency Penalty <Typography component="span" sx={{ color: 'var(--color-primary-50)' }}>{frequencyPenalty}</Typography>
                </Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Typography variant="caption" sx={{ color: C.textMuted, minWidth: 30 }}>-2</Typography>
                  <input
                    type="range"
                    min="-2"
                    max="2"
                    step="0.1"
                    value={frequencyPenalty}
                    onChange={(e) => setFrequencyPenalty(e.target.value)}
                    style={{ flex: 1, accentColor: 'var(--color-primary-50)' }}
                  />
                  <Typography variant="caption" sx={{ color: C.textMuted, minWidth: 30 }}>2</Typography>
                </Box>
                <Typography variant="caption" sx={{ color: C.textMuted, fontSize: '0.7rem' }}>
                  Penalize frequent tokens
                </Typography>
              </Box>

              <Box>
                <Typography variant="caption" sx={{ color: C.textMuted, mb: 0.5, display: 'block' }}>
                  Presence Penalty <Typography component="span" sx={{ color: 'var(--color-primary-50)' }}>{presencePenalty}</Typography>
                </Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Typography variant="caption" sx={{ color: C.textMuted, minWidth: 30 }}>-2</Typography>
                  <input
                    type="range"
                    min="-2"
                    max="2"
                    step="0.1"
                    value={presencePenalty}
                    onChange={(e) => setPresencePenalty(e.target.value)}
                    style={{ flex: 1, accentColor: 'var(--color-primary-50)' }}
                  />
                  <Typography variant="caption" sx={{ color: C.textMuted, minWidth: 30 }}>2</Typography>
                </Box>
                <Typography variant="caption" sx={{ color: C.textMuted, fontSize: '0.7rem' }}>
                  Penalize repeated topics
                </Typography>
              </Box>
            </Box>
          </Box>
        </Paper>
      )}

      <Box sx={{ mt: 3, display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 1.5 }}>
        {saving && <CircularProgress size={16} />}
        <Box
          onClick={handleSave}
          sx={{
            px: 3,
            py: 1.5,
            borderRadius: 2,
            background: 'var(--color-primary-50)',
            color: 'white',
            cursor: 'pointer',
            fontWeight: 600,
            fontSize: '0.875rem',
            opacity: saving ? 0.7 : 1,
            '&:hover': { background: 'var(--color-primary-40)' },
          }}
        >
          Save Settings
        </Box>
      </Box>

      <Snackbar
        open={snackbarOpen}
        autoHideDuration={3000}
        onClose={() => setSnackbarOpen(false)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity="success" onClose={() => setSnackbarOpen(false)} sx={{ width: '100%' }}>
          {snackbarMsg}
        </Alert>
      </Snackbar>

      {/* FU-287 — explicit confirmation before clearing the stored key. */}
      <Dialog open={removeKeyDialogOpen} onClose={() => setRemoveKeyDialogOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontSize: 16, fontWeight: 600 }}>Remove stored API key?</DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ color: C.textMuted }}>
            {aiConfig?.operatorDefaults.baseUrl
              ? `The assistant will fall back to the platform default provider (${aiConfig.operatorDefaults.baseUrl}${aiConfig.operatorDefaults.model ? `, model ${aiConfig.operatorDefaults.model}` : ''}) until you save a new key.`
              : 'No platform default provider is configured on this deployment — the assistant will have no working provider until you save a new key or switch to Local.'}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRemoveKeyDialogOpen(false)} sx={{ color: 'var(--theme-text-muted)' }}>
            Cancel
          </Button>
          <Button
            onClick={() => { setRemoveKeyDialogOpen(false); handleRemoveStoredKey() }}
            sx={{ color: 'var(--color-status-warning)' }}
          >
            Remove key
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}

// ─── Main Component ────────────────────────────────────────────────────────────
const TAB_HASHES = ['account', 'company', 'wallet', 'ai'] as const

export function Settings() {
  const navigate = useNavigate()
  const { theme, themePreference, setThemePreference } = useTheme()
  const [tabValue, setTabValue] = useState(() => {
    const hash = window.location.hash.replace('#', '')
    const idx = TAB_HASHES.indexOf(hash as (typeof TAB_HASHES)[number])
    return idx >= 0 ? idx : 0
  })

  const handleChange = (_event: React.SyntheticEvent, newValue: number) => {
    setTabValue(newValue)
  }

  return (
    <PageContainer size="narrow" spacing="lg">
      <PageHeader
        icon={<SettingsIcon fontSize="medium" />}
        title="Settings"
        subtitle="Manage your preferences and entity settings"
        onBack={() => navigate('/')}
      />

      <Box sx={{ mt: 2 }}>
        <Tabs
          value={tabValue}
          onChange={handleChange}
          variant="scrollable"
          scrollButtons="auto"
          sx={{
            '& .MuiTabs-indicator': { backgroundColor: 'var(--color-primary-50)' },
            '& .MuiTab-root': {
              color: 'var(--theme-text-muted)',
              '&.Mui-selected': { color: 'var(--color-primary-50)' },
            },
          }}
        >
          <Tab label="Account" />
          <Tab label="Company" />
          <Tab label="Wallet" />
          <Tab label="AI Assistant" />
        </Tabs>

        <Box sx={{ mt: { xs: 3, md: 4, lg: 5 } }}>
          {tabValue === 0 && <AccountSettingsTab theme={theme} themePreference={themePreference} setThemePreference={setThemePreference} />}
          {tabValue === 1 && <CompanySettingsTab />}
          {tabValue === 2 && <SettingsWalletTab />}
          {tabValue === 3 && <AISettingsTab />}
        </Box>
      </Box>
    </PageContainer>
  )
}
