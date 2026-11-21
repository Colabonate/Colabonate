import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Box,
  Tabs,
  Tab,
  Typography,
  Chip,
  CircularProgress,
} from '@mui/material'
import AdminPanelSettingsIcon from '@mui/icons-material/AdminPanelSettings'
import AccountCircleIcon from '@mui/icons-material/AccountCircle'
import FeedbackIcon from '@mui/icons-material/Feedback'
import MonitorHeartIcon from '@mui/icons-material/MonitorHeart'
import StorageIcon from '@mui/icons-material/Storage'
import { PageContainer } from '@ds/ui'
import { PageHeader } from '../../components/PageHeader'
import { apiCall } from '../../lib/api'
import { AccountsSection } from './sections/AccountsSection'
import { FeedbackSection } from './sections/FeedbackSection'
import { HealthSection } from './sections/HealthSection'
import { EntitiesSection } from './sections/EntitiesSection'
import { AdminKpiStrip } from './AdminKpiStrip'

// ADR-273: server-confirmed admin role via /api/auth/me (isAdmin). The former
// VITE_ADMIN_PUBKEY + localStorage.pubkey client check was trivially bypassable
// and bundled the admin pubkey in the JS.
interface MeResponse {
  pubkey: string
  identityLevel: number
  isAdmin: boolean
}

export function AdminPage() {
  const navigate = useNavigate()
  const [tab, setTab] = useState(0)
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
        const me = (await res.json()) as MeResponse
        if (cancelled) return
        if (!me.isAdmin) {
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
    <PageContainer size="wide" spacing="lg">
      <PageHeader
        icon={<AdminPanelSettingsIcon fontSize="medium" />}
        title="Admin Panel"
        subtitle="Foundation DAO — Beta operations"
        onBack={() => navigate('/')}
        actions={
          <Chip
            label="ADMIN"
            size="small"
            sx={{
              fontSize: '0.65rem',
              fontWeight: 700,
              height: 20,
              bgcolor: 'var(--color-warning-default, #f59e0b)',
              color: '#fff',
              letterSpacing: '0.05em',
            }}
          />
        }
      />

      <Box sx={{ mt: 2, mb: 3 }}>
        <AdminKpiStrip />
      </Box>

      <Box sx={{ mt: 0 }}>
        <Tabs
          value={tab}
          onChange={(_, v) => setTab(v)}
          variant="scrollable"
          scrollButtons="auto"
          sx={{
            '& .MuiTabs-indicator': { backgroundColor: 'var(--color-warning-default, #f59e0b)' },
            '& .MuiTab-root': {
              color: 'var(--theme-text-muted)',
              minHeight: 48,
              '&.Mui-selected': { color: 'var(--color-warning-default, #f59e0b)' },
            },
          }}
        >
          <Tab
            icon={<AccountCircleIcon fontSize="small" />}
            iconPosition="start"
            label={<Typography variant="body2" fontWeight={600}>Accounts</Typography>}
          />
          <Tab
            icon={<FeedbackIcon fontSize="small" />}
            iconPosition="start"
            label={<Typography variant="body2" fontWeight={600}>Feedback Inbox</Typography>}
          />
          <Tab
            icon={<MonitorHeartIcon fontSize="small" />}
            iconPosition="start"
            label={<Typography variant="body2" fontWeight={600}>System Health</Typography>}
          />
          <Tab
            icon={<StorageIcon fontSize="small" />}
            iconPosition="start"
            label={<Typography variant="body2" fontWeight={600}>Entities</Typography>}
          />
        </Tabs>

        <Box sx={{ mt: 3 }}>
          {tab === 0 && <AccountsSection />}
          {tab === 1 && <FeedbackSection />}
          {tab === 2 && <HealthSection />}
          {tab === 3 && <EntitiesSection />}
        </Box>
      </Box>
    </PageContainer>
  )
}
