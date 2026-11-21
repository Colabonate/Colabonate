import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Box, Button, TextField, Typography } from '@mui/material'
import ShieldIcon from '@mui/icons-material/Shield'
import SearchIcon from '@mui/icons-material/Search'
import { PageCard, PageContainer } from '@ds/ui'
import { PageHeader } from '../../components/PageHeader'
import { Seo } from '../../components/Seo'
import { CanisterTrustPanel } from '../../components/trust/CanisterTrustPanel'
import { defaultEscrowCanisterId, verifyCanister } from '../../lib/icp-verification'

/**
 * /trade/verify — the public, unauthenticated trust surface (ADR-356 D3).
 * Anyone — a buyer, an auditor, a regulator, a court expert — can point it at a
 * canister id and check what code runs and who can change it, without an
 * account and without trusting Colabonate.
 */
export function Verify() {
  const { canisterId } = useParams<{ canisterId: string }>()
  const navigate = useNavigate()
  const defaultId = defaultEscrowCanisterId()
  const [draft, setDraft] = useState(canisterId ?? defaultId ?? '')
  const [localId, setLocalId] = useState<string | null>(canisterId ?? defaultId)

  const activeId = canisterId ?? localId

  const verifyQuery = useQuery({
    queryKey: ['canister-verify', activeId],
    queryFn: () => verifyCanister(activeId as string),
    enabled: !!activeId,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  })

  function onVerify() {
    const id = draft.trim()
    if (!id) return
    if (canisterId === id) {
      void verifyQuery.refetch()
    } else if (canisterId !== undefined) {
      navigate(`/trade/verify/${encodeURIComponent(id)}`)
    } else {
      setLocalId(id)
    }
  }

  return (
    <>
      <Seo
        title="Escrow canister verification"
        description="Verify yourself what code holds Colabonate escrow funds — certified on-chain module hash and controller set, no account needed."
        path="/trade/verify"
      />
      <PageContainer>
        <PageHeader
          icon={<ShieldIcon sx={{ fontSize: 22 }} />}
          title="Escrow canister verification"
          subtitle="Check, yourself, what code holds escrow funds — no account needed."
        />

        <PageCard>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
            <Typography variant="body2" sx={{ color: 'var(--theme-text-muted)' }}>
              Your browser reads the canister&apos;s module hash and controller set directly from the
              Internet Computer and verifies the certificate against the NNS root key. No Colabonate
              server is in the trust path — this page still verifies if our servers are unreachable.
            </Typography>
            <Box sx={{ display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, gap: 1 }}>
              <TextField
                size="small"
                fullWidth
                placeholder="Canister id (e.g. aaaaa-bbbbb-…) "
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') onVerify() }}
                sx={{ fontFamily: 'monospace' }}
                inputProps={{ 'aria-label': 'Canister id' }}
              />
              <Button
                variant="contained"
                startIcon={<SearchIcon sx={{ fontSize: 18 }} />}
                onClick={onVerify}
                disabled={!draft.trim()}
                sx={{ textTransform: 'none', flexShrink: 0 }}
              >
                Verify
              </Button>
            </Box>
          </Box>
        </PageCard>

        <Box sx={{ mt: 2 }}>
          {activeId ? (
            <CanisterTrustPanel
              canisterId={activeId}
              loading={verifyQuery.isLoading || verifyQuery.isFetching}
              outcome={verifyQuery.data ?? null}
              onReverify={() => void verifyQuery.refetch()}
            />
          ) : (
            <PageCard>
              <Typography variant="body2" sx={{ color: 'var(--theme-text-muted)' }}>
                Enter a canister id to begin. The platform&apos;s pilot escrow canister is not yet
                deployed; once it is, it will verify here by default.
              </Typography>
            </PageCard>
          )}
        </Box>
      </PageContainer>
    </>
  )
}
