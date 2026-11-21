// ADR-402 D16: explicit newsletter opt-in shown where an account gets an
// email address (email login, onboarding email path, Alby login).
// Consent rules: never pre-ticked, not required to continue, separate from the
// terms. If this wording changes, bump NEWSLETTER_CONSENT_TEXT_VERSION on the
// server (apps/server/services/newsletter.ts) so recorded consent stays exact.
import { Checkbox, FormControlLabel, Typography } from '@mui/material'
import { Link } from 'react-router-dom'

interface NewsletterOptInCheckboxProps {
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
}

export function NewsletterOptInCheckbox({ checked, onChange, disabled }: NewsletterOptInCheckboxProps) {
  return (
    <FormControlLabel
      sx={{ alignItems: 'flex-start', m: 0, gap: 1 }}
      control={
        <Checkbox
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
          size="small"
          sx={{ p: 0.25, mt: 0.25, color: 'var(--theme-text-muted)', '&.Mui-checked': { color: 'var(--color-primary-50)' } }}
          slotProps={{ input: { 'aria-describedby': 'newsletter-optin-note' } }}
        />
      }
      label={
        <Typography component="span" variant="body2" sx={{ color: 'var(--theme-text-muted)', fontSize: '0.8125rem', lineHeight: 1.55 }}>
          Yes, send me the Colabonate newsletter about our community and open markets.{' '}
          <span id="newsletter-optin-note">
            Optional. You can unsubscribe at any time (
            <Link to="/legal/privacy" style={{ color: 'var(--color-primary-50)' }}>
              privacy
            </Link>
            ).
          </span>
        </Typography>
      }
    />
  )
}
