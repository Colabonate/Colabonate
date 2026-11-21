import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { Box, Typography, Chip, Divider, CircularProgress } from '@mui/material'
import AdminPanelSettingsIcon from '@mui/icons-material/AdminPanelSettings'
import DashboardIcon          from '@mui/icons-material/Dashboard'
import PeopleAltIcon          from '@mui/icons-material/PeopleAlt'
import FeedbackIcon           from '@mui/icons-material/Feedback'
import MarkEmailReadIcon      from '@mui/icons-material/MarkEmailRead'
import StorageIcon            from '@mui/icons-material/Storage'
import BoltIcon               from '@mui/icons-material/Bolt'
import SchemaIcon             from '@mui/icons-material/Schema'
import CloudSyncIcon          from '@mui/icons-material/CloudSync'
import VerifiedUserIcon       from '@mui/icons-material/VerifiedUser'
import SmartToyIcon           from '@mui/icons-material/SmartToy'
import TuneIcon               from '@mui/icons-material/Tune'
import RocketLaunchIcon       from '@mui/icons-material/RocketLaunch'
import ArrowBackIcon          from '@mui/icons-material/ArrowBack'
import { apiCall } from '../../lib/api'
import { useBetaMode } from '../../hooks/useBetaMode'

// ADR-273: server-confirmed admin role via /api/auth/me.isAdmin. Replaces the
// old VITE_ADMIN_PUBKEY + localStorage.pubkey client check (trivially
// bypassable; bundled the admin pubkey in the JS). Items with `betaOnly` are
// hidden when the runtime betaMode flag is off (ADR-197).
const NAV_ITEMS = [
  { to: '/admin/overview', label: 'Overview',     icon: <DashboardIcon   sx={{ fontSize: 18 }} />, betaOnly: false },
  { to: '/admin/launch-readiness', label: 'Launch Readiness', icon: <RocketLaunchIcon sx={{ fontSize: 18 }} />, betaOnly: false },
  { to: '/admin/accounts', label: 'Accounts',     icon: <PeopleAltIcon   sx={{ fontSize: 18 }} />, betaOnly: false },
  { to: '/admin/newsletter', label: 'Newsletter', icon: <MarkEmailReadIcon sx={{ fontSize: 18 }} />, betaOnly: false },
  { to: '/admin/feedback', label: 'Feedback',     icon: <FeedbackIcon    sx={{ fontSize: 18 }} />, betaOnly: false },
  { to: '/admin/beta',     label: 'Beta Testers', icon: <BoltIcon        sx={{ fontSize: 18 }} />, betaOnly: true  },
  { to: '/admin/entities', label: 'Entities',     icon: <StorageIcon     sx={{ fontSize: 18 }} />, betaOnly: false },
  { to: '/admin/remote-candidates', label: 'Remote Candidates', icon: <CloudSyncIcon sx={{ fontSize: 18 }} />, betaOnly: false },
  { to: '/admin/agents',  label: 'Agent Verification', icon: <SmartToyIcon sx={{ fontSize: 18 }} />, betaOnly: false },
  { to: '/admin/mcp-connections', label: 'MCP Connections', icon: <SmartToyIcon sx={{ fontSize: 18 }} />, betaOnly: false },
  { to: '/admin/settings', label: 'Sales & Visibility', icon: <TuneIcon sx={{ fontSize: 18 }} />, betaOnly: false },
  { to: '/admin/foundation-bootstrap', label: 'Foundation Bootstrap', icon: <VerifiedUserIcon sx={{ fontSize: 18 }} />, betaOnly: false },
  { to: '/admin/schema',   label: 'Schema',       icon: <SchemaIcon      sx={{ fontSize: 18 }} />, betaOnly: false },
]

export function AdminLayout() {
  const navigate = useNavigate()
  const { isBeta } = useBetaMode()
  const [authorized, setAuthorized] = useState<boolean | null>(null)

  useEffect(() => {
    let cancelled = false
    async function check() {
      try {
        const res = await apiCall('/api/auth/me')
        if (!res.ok) {
          if (!cancelled) {
            navigate('/', { replace: true })
            setAuthorized(false)
          }
          return
        }
        const me = await res.json()
        if (cancelled) return
        if (!me?.isAdmin) {
          navigate('/', { replace: true })
          setAuthorized(false)
          return
        }
        setAuthorized(true)
      } catch {
        if (!cancelled) {
          navigate('/', { replace: true })
          setAuthorized(false)
        }
      }
    }
    check()
    return () => { cancelled = true }
  }, [navigate])

  if (authorized === null) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '50vh' }}>
        <CircularProgress size={32} />
      </Box>
    )
  }
  if (authorized === false) return null

  return (
    <Box sx={{
      display: 'flex',
      height: '100vh',
      overflow: 'hidden',
      bgcolor: 'var(--theme-bg)',
    }}>

      {/* ── Sidebar ─────────────────────────────────────────────────────────── */}
      <Box sx={{
        width: 224,
        flexShrink: 0,
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        bgcolor: 'var(--theme-surface)',
        borderRight: '1px solid var(--theme-border)',
        overflowY: 'auto',
      }}>

        {/* Brand header */}
        <Box sx={{ px: 2.5, pt: 3, pb: 2.5 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <AdminPanelSettingsIcon sx={{ fontSize: 20, color: 'var(--color-warning-default, #f59e0b)', flexShrink: 0 }} />
            <Typography variant="body2" fontWeight={700} sx={{ color: 'var(--theme-text)', letterSpacing: '0.01em', flex: 1 }}>
              Admin Panel
            </Typography>
            <Chip
              label="BETA"
              size="small"
              sx={{
                fontSize: '0.55rem', fontWeight: 800, height: 16,
                bgcolor: 'var(--color-warning-default, #f59e0b)',
                color: '#fff',
                letterSpacing: '0.06em',
              }}
            />
          </Box>
          <Typography variant="caption" sx={{ color: 'var(--theme-text-muted)', fontSize: '0.68rem', mt: 0.5, display: 'block' }}>
            Foundation DAO
          </Typography>
        </Box>

        <Divider sx={{ borderColor: 'var(--theme-border)' }} />

        {/* Navigation */}
        <Box component="nav" sx={{ flex: 1, py: 1.5, px: 1 }}>
          {NAV_ITEMS.filter(item => isBeta || !item.betaOnly).map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              style={{ textDecoration: 'none', display: 'block' }}
            >
              {({ isActive }) => (
                <Box sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1.25,
                  px: 1.5,
                  py: 0.875,
                  borderRadius: 1.5,
                  mb: 0.25,
                  bgcolor: isActive
                    ? 'var(--color-warning-subtle, rgba(245,158,11,0.12))'
                    : 'transparent',
                  color: isActive
                    ? 'var(--color-warning-default, #f59e0b)'
                    : 'var(--theme-text-muted)',
                  transition: 'background 0.15s, color 0.15s',
                  cursor: 'pointer',
                  '&:hover': isActive ? {} : {
                    bgcolor: 'var(--theme-bg)',
                    color: 'var(--theme-text)',
                  },
                }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', color: 'inherit', flexShrink: 0 }}>
                    {item.icon}
                  </Box>
                  <Typography
                    variant="body2"
                    sx={{
                      fontSize: '0.85rem',
                      fontWeight: isActive ? 700 : 500,
                      color: 'inherit',
                      lineHeight: 1.2,
                    }}
                  >
                    {item.label}
                  </Typography>
                </Box>
              )}
            </NavLink>
          ))}
        </Box>

        <Divider sx={{ borderColor: 'var(--theme-border)' }} />

        {/* Back to app */}
        <Box
          onClick={() => navigate('/')}
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            px: 2.5,
            py: 2,
            cursor: 'pointer',
            color: 'var(--theme-text-muted)',
            transition: 'color 0.15s',
            '&:hover': { color: 'var(--theme-text)' },
          }}
        >
          <ArrowBackIcon sx={{ fontSize: 15 }} />
          <Typography variant="caption" sx={{ fontSize: '0.78rem' }}>
            Back to App
          </Typography>
        </Box>
      </Box>

      {/* ── Content area ────────────────────────────────────────────────────── */}
      <Box sx={{
        flex: 1,
        height: '100vh',
        overflowY: 'auto',
      }}>
        <Box sx={{
          px: { xs: 2.5, sm: 3.5, md: 5 },
          py: { xs: 2.5, sm: 3.5 },
          // ADR-284 D4: use the full desktop viewport instead of capping at
          // 1440px — the admin content area should fill whatever width the
          // desktop actually offers.
          width: '100%',
        }}>
          <Outlet />
        </Box>
      </Box>

    </Box>
  )
}
