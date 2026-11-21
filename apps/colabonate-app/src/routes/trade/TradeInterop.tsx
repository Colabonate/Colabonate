import { useQuery } from '@tanstack/react-query'
import { useParams } from 'react-router-dom'
import { Box, CircularProgress, Typography } from '@mui/material'
import AccountBalanceIcon from '@mui/icons-material/AccountBalance'
import { PageCard, PageContainer } from '@ds/ui'
import { PageHeader } from '../../components/PageHeader'
import { Seo } from '../../components/Seo'
import { IsoInteropPanel } from '../../components/trade/IsoInteropPanel'
import { fetchEscrowTrade } from '../../lib/escrow-trade'

/**
 * /trade/:tradeId/interop — ISO 20022 interoperability view (ADR-360).
 * Confined to its own route; never blocks the core flow. Scrupulously honest
 * about being a complementary layer, not a bank-settlement participant.
 */
export function TradeInterop() {
  const { tradeId } = useParams<{ tradeId: string }>()

  const detailQuery = useQuery({
    queryKey: ['escrow-trade', tradeId],
    queryFn: () => fetchEscrowTrade(tradeId as string),
    enabled: !!tradeId,
  })

  const trade = detailQuery.data?.trade

  return (
    <>
      <Seo title="Escrow trade — ISO 20022 interop" description="ISO 20022 interoperability view for an escrow trade — complementary layer, conceptual correspondence." path={`/trade/${tradeId}/interop`} />
      <PageContainer>
        <PageHeader
          icon={<AccountBalanceIcon sx={{ fontSize: 22 }} />}
          title="ISO 20022 interop"
          subtitle="How this trade corresponds to ISO 20022 payment messaging — conceptual, not bank settlement."
        />

        {detailQuery.isLoading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress size={24} /></Box>
        ) : !trade ? (
          <PageCard><Typography variant="body2" sx={{ color: 'var(--theme-text-muted)' }}>Trade not found.</Typography></PageCard>
        ) : (
          <PageCard>
            <IsoInteropPanel trade={trade} />
          </PageCard>
        )}
      </PageContainer>
    </>
  )
}
