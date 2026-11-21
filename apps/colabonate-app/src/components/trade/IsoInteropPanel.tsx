import { Alert, Box, Button, Table, TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material'
import DownloadIcon from '@mui/icons-material/Download'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import { ISO_STATUS_MAP, PACS008_MAPPING, generatePacs002Xml, xidRecognitionPrefix } from '../../lib/iso20022'
import type { EscrowTrade } from '../../lib/escrow-trade'

/**
 * IsoInteropPanel (ADR-360) — the ISO 20022 interoperability view. Scrupulously
 * honest about its own status: a complementary layer, never a claim of bank
 * settlement. The non-dismissible disclosure is always visible; every ISO code
 * carries a "conceptual mapping" marker; Disputed/DisputeSettled are gap markers.
 */
export function IsoInteropPanel({ trade }: { trade: EscrowTrade }) {
  const row = ISO_STATUS_MAP[trade.state] ?? ISO_STATUS_MAP.PENDING_FUNDING

  const onDownloadPacs002 = () => {
    const xml = generatePacs002Xml(trade, trade.state, new Date().toISOString())
    const blob = new Blob([xml], { type: 'application/xml' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `pacs.002.${trade.canisterTradeId}.xml`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
      {/* D1 — non-dismissible disclosure */}
      <Alert severity="info" sx={{ borderRadius: 2, '& .MuiAlert-message': { width: '100%' } }}>
        <Typography variant="subtitle2">Complementary layer — read before relying on this view</Typography>
        <Typography component="ul" variant="body2" sx={{ pl: 2.5, mt: 0.5, display: 'flex', flexDirection: 'column', gap: 0.25 }}>
          <li>This is a complementary layer <strong>above</strong> ISO 20022 — not a replacement and not a participant.</li>
          <li><strong>No bank settlement occurs.</strong> No financial institution processes these messages.</li>
          <li>The canister contains <strong>no ISO 20022 code</strong>; the correspondence is conceptual and the adapter is out of band.</li>
        </Typography>
      </Alert>

      {/* End-to-end id (D5) — the reconciliation handle */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
        <Typography variant="body2" sx={{ color: 'var(--theme-text-muted)' }}>End-to-end id</Typography>
        <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>{trade.canisterTradeId}</Typography>
        <Button
          size="small"
          startIcon={<ContentCopyIcon sx={{ fontSize: 14 }} />}
          onClick={() => { navigator.clipboard.writeText(trade.canisterTradeId).catch(() => {}) }}
          sx={{ textTransform: 'none' }}
        >
          Copy
        </Button>
      </Box>

      {/* D2/D3 — state-to-status correspondence */}
      <Box>
        <Typography variant="overline" sx={{ color: 'var(--theme-text-muted)', letterSpacing: '0.08em' }}>State correspondence (conceptual)</Typography>
        <Table size="small" sx={{ mt: 0.5 }}>
          <TableHead>
            <TableRow>
              <TableCell>Canister state</TableCell>
              <TableCell>ISO status</TableCell>
              <TableCell>Economic correspondence</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {(Object.keys(ISO_STATUS_MAP) as (keyof typeof ISO_STATUS_MAP)[]).map((state) => {
              const r = ISO_STATUS_MAP[state]
              const active = state === trade.state
              return (
                <TableRow key={state} sx={{ bgcolor: active ? 'var(--theme-bg-accent)' : undefined }}>
                  <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.78rem', fontWeight: active ? 600 : 400 }}>{state}</TableCell>
                  <TableCell>
                    {r.isoCode ? (
                      <Typography component="span" variant="body2" sx={{ fontFamily: 'monospace' }}>
                        {r.isoCode}
                        <Typography component="span" variant="caption" sx={{ color: 'var(--theme-text-muted)', ml: 0.5 }}>(conceptual)</Typography>
                      </Typography>
                    ) : (
                      <Typography component="span" variant="body2" sx={{ color: 'var(--color-status-warning)' }}>
                        gap marker — {r.note}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell><Typography variant="body2">{r.economic}</Typography></TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
        <Typography variant="caption" sx={{ color: 'var(--theme-text-muted)' }}>
          Current state: <strong>{trade.state}</strong>{row.isoCode ? ` → ${row.isoCode}` : ' — no ISO analogue (gap marker)'}. {row.note}
        </Typography>
      </Box>

      {/* D4 — identifier slots with Max35Text caveat */}
      <Box>
        <Typography variant="overline" sx={{ color: 'var(--theme-text-muted)', letterSpacing: '0.08em' }}>Party identifiers (Othr/Prtry — hint, not proof)</Typography>
        <Typography variant="body2" sx={{ mt: 0.5 }}>
          Buyer XID prefix: <Typography component="span" sx={{ fontFamily: 'monospace' }}>{xidRecognitionPrefix(trade.buyerPubkey)}</Typography>
          {' '}· Seller XID prefix: <Typography component="span" sx={{ fontFamily: 'monospace' }}>{xidRecognitionPrefix(trade.sellerPubkey)}</Typography>
        </Typography>
        <Typography variant="caption" sx={{ color: 'var(--theme-text-muted)' }}>
          The Othr.Id field is limited to 35 characters (Max35Text); a full 32-byte XID does not fit. This carries only a
          4-byte recognition prefix — full 32-byte machine comparison happens out of band. XID is a proposed extension, not a shipped capability.
        </Typography>
      </Box>

      {/* D5 — pacs.008 preview table */}
      <Box>
        <Typography variant="overline" sx={{ color: 'var(--theme-text-muted)', letterSpacing: '0.08em' }}>pacs.008 mapping preview (read-only)</Typography>
        <Table size="small" sx={{ mt: 0.5 }}>
          <TableHead>
            <TableRow>
              <TableCell>ISO 20022 XML path</TableCell>
              <TableCell>Canister Candid field</TableCell>
              <TableCell>Conversion</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {PACS008_MAPPING.map((m) => (
              <TableRow key={m.xmlPath}>
                <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.74rem' }}>{m.xmlPath}</TableCell>
                <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.74rem' }}>{m.candidField}</TableCell>
                <TableCell><Typography variant="body2">{m.conversion}</Typography></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <Typography variant="caption" sx={{ color: 'var(--theme-text-muted)' }}>
          XML ingestion is not built — accepting bank messages would imply a financial-institution role we do not hold.
        </Typography>
      </Box>

      {/* D5 — pacs.002 export */}
      <Box>
        <Button
          variant="outlined"
          startIcon={<DownloadIcon sx={{ fontSize: 16 }} />}
          onClick={onDownloadPacs002}
          sx={{ textTransform: 'none' }}
        >
          Download pacs.002 status report
        </Button>
        <Typography variant="caption" sx={{ color: 'var(--theme-text-muted)', display: 'block', mt: 0.5 }}>
          Generated by the Colabonate adapter for interoperability purposes. Full XSD validation lives in the standalone adapter (FU-595/FU-630).
        </Typography>
      </Box>
    </Box>
  )
}
