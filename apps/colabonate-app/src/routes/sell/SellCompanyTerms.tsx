// Company Legal & Terms editor – AGB, Impressum, Datenschutz (ADR-112 Phase 3)

import { useState, useEffect, useCallback } from 'react'
import {
  Alert,
  Box,
  CircularProgress,
  Divider,
  Grid,
  TextField,
  Typography,
} from '@mui/material'
import SaveOutlinedIcon from '@mui/icons-material/SaveOutlined'
import GavelOutlinedIcon from '@mui/icons-material/GavelOutlined'
import { apiCall } from '../../lib/api'

export function SellCompanyTerms() {
  const [pubkey] = useState(() => localStorage.getItem('pubkey') ?? '')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  const [formData, setFormData] = useState({
    terms: '',
    imprint: '',
    privacyPolicy: '',
    legalJurisdiction: '',
    taxId: '',
  })

  const loadCompany = useCallback(async () => {
    if (!pubkey) { setLoading(false); return }
    try {
      const res = await apiCall(`/api/company/${pubkey}`).then(r => r.json())
      if (res.company) {
        setFormData({
          terms: res.company.terms ?? '',
          imprint: res.company.imprint ?? '',
          privacyPolicy: res.company.privacyPolicy ?? '',
          legalJurisdiction: res.company.legalJurisdiction ?? '',
          taxId: res.company.taxId ?? '',
        })
      }
    } catch {
      setError('Failed to load company data.')
    } finally {
      setLoading(false)
    }
  }, [pubkey])

  useEffect(() => { loadCompany() }, [loadCompany])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!pubkey) return
    setSaving(true)
    setError('')
    setSaved(false)
    try {
      const res = await apiCall(`/api/company/${pubkey}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      })
      if (!res.ok) throw new Error('Save failed')
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch {
      setError('Failed to save legal information.')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
        <CircularProgress size={32} />
      </Box>
    )
  }

  return (
    <Box sx={{ p: { xs: 2, md: 3 }, maxWidth: 800 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 3 }}>
        <GavelOutlinedIcon color="action" />
        <Box>
          <Typography
            variant="h5"
            fontWeight={700}
            sx={{ fontFamily: 'var(--typography-fontfamily-display, sans-serif)' }}
          >
            Legal & Terms
          </Typography>
          <Typography variant="body2" color="text.secondary">
            AGB, Impressum, Datenschutz und Steuerinformationen für dein Unternehmen.
          </Typography>
        </Box>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {saved && <Alert severity="success" sx={{ mb: 2 }}>Legal information saved.</Alert>}

      <Box component="form" onSubmit={handleSubmit} sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>

        {/* Identity */}
        <Box>
          <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1.5 }}>
            Legal Identity
          </Typography>
          <Grid container spacing={2}>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                label="Legal Jurisdiction"
                value={formData.legalJurisdiction}
                onChange={e => setFormData(p => ({ ...p, legalJurisdiction: e.target.value }))}
                placeholder="e.g. Germany, EU, Austria"
                fullWidth
                helperText="Country or jurisdiction for legal purposes"
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                label="Tax ID / VAT Number"
                value={formData.taxId}
                onChange={e => setFormData(p => ({ ...p, taxId: e.target.value }))}
                placeholder="e.g. DE123456789"
                fullWidth
                helperText="Steuernummer or VAT-ID"
              />
            </Grid>
          </Grid>
        </Box>

        <Divider />

        {/* Terms / AGB */}
        <Box>
          <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 0.5 }}>
            Terms & Conditions (AGB)
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
            These terms will be linked from your cooperation proposals. Markdown is supported.
          </Typography>
          <TextField
            label="Terms & Conditions"
            value={formData.terms}
            onChange={e => setFormData(p => ({ ...p, terms: e.target.value }))}
            multiline
            rows={6}
            fullWidth
            placeholder="§1 Geltungsbereich&#10;§2 Leistungsbeschreibung&#10;..."
            helperText="Markdown or plain text"
          />
        </Box>

        <Divider />

        {/* Impressum */}
        <Box>
          <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 0.5 }}>
            Impressum
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
            Pflichtangaben gemäß § 5 TMG (Deutschland) oder nationalem Äquivalent.
          </Typography>
          <TextField
            label="Impressum"
            value={formData.imprint}
            onChange={e => setFormData(p => ({ ...p, imprint: e.target.value }))}
            multiline
            rows={5}
            fullWidth
            placeholder="Firmenname GmbH&#10;Musterstraße 1&#10;12345 Stadt&#10;Geschäftsführer: Max Mustermann&#10;..."
            helperText="Markdown or plain text"
          />
        </Box>

        <Divider />

        {/* Privacy Policy */}
        <Box>
          <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 0.5 }}>
            Privacy Policy (Datenschutzerklärung)
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
            DSGVO-konforme Datenschutzerklärung für Kooperationspartner.
          </Typography>
          <TextField
            label="Privacy Policy"
            value={formData.privacyPolicy}
            onChange={e => setFormData(p => ({ ...p, privacyPolicy: e.target.value }))}
            multiline
            rows={5}
            fullWidth
            placeholder="1. Verantwortlicher&#10;2. Erhobene Daten&#10;3. Zweck der Verarbeitung&#10;..."
            helperText="Markdown or plain text"
          />
        </Box>

        {/* Save */}
        <Box
          component="button"
          type="submit"
          disabled={saving}
          sx={{
            alignSelf: 'flex-start',
            display: 'inline-flex', alignItems: 'center', gap: 1,
            px: 3, py: 1.25,
            borderRadius: 2,
            border: 'none',
            bgcolor: 'primary.main',
            color: 'white',
            fontWeight: 700,
            fontSize: '0.9375rem',
            cursor: saving ? 'default' : 'pointer',
            opacity: saving ? 0.7 : 1,
            '&:hover': { opacity: saving ? 0.7 : 0.88 },
          }}
        >
          <SaveOutlinedIcon fontSize="small" />
          {saving ? 'Saving…' : 'Save Legal Information'}
        </Box>
      </Box>
    </Box>
  )
}
