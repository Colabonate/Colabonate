// WalletDashboard – overview page with balance, price, transactions
// Scope: ADR-091
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Wallet as WalletIcon, Send as SendIcon, ShoppingCart as ShoppingCartIcon, ArrowRight as ArrowForwardIcon, ChevronLeft as ChevronLeftIcon, ChevronRight as ChevronRightIcon } from '@mui/icons-material'
import { PageContainer } from '@ds/ui'
import { ListHeader } from '@ds/ui'
import { PageHeader } from '../../components/PageHeader'
import { cn } from '@ds/utils'
import { useCart } from '../../context/CartContext'
import { useWallet } from '../../contexts/WalletContext'
import { useBetaMode } from '../../hooks/useBetaMode'
import { useWalletTransactions, useWalletTickets, useSubWallets } from '../../hooks/useEntityQueries'
import { useLnAddress } from '../../hooks/useLnAddress'
import { isOpenTransaction } from '../../lib/walletTransactionView'
import { BalanceCard } from '../../components/wallet/BalanceCard'
import { WalletCreateCard } from '../../components/wallet/WalletCreateCard'
import { PriceStrip } from '../../components/wallet/PriceStrip'
import { TransactionCard } from '../../components/wallet/TransactionCard'
import { TransactionSummary, type TimeFilter } from '../../components/wallet/TransactionSummary'
import { EscrowStatusPanel } from '../../components/wallet/EscrowStatusPanel'
import { MultiWalletSwitcher } from '../../components/wallet/MultiWalletSwitcher'
import { SubWalletPanel } from '../../components/wallet/SubWalletPanel'
import { CashuPanel } from '../../components/wallet/cashu/CashuPanel'
import { NwcPanel } from '../../components/wallet/NwcPanel'

const TX_TABS = [
  { key: 'all', label: 'All' },
  // Ticket-aware history: "Open" surfaces everything that still needs the user
  // (unpaid direct-pay, active escrow) across the type tabs.
  { key: 'OPEN', label: 'Open' },
  { key: 'SENT', label: 'Sent' },
  { key: 'RECEIVED', label: 'Received' },
  { key: 'ESCROW_HOLD', label: 'Escrow' },
  { key: 'ESCROW_RELEASE', label: 'Released' },
  { key: 'ESCROW_REFUND', label: 'Refunded' },
]

export function WalletDashboard() {
  const navigate = useNavigate()
  const { totalSats: cartTotalSats } = useCart()
  const { wallet, wallets, isLoading: walletLoading, refreshBalance, createWallet, connectWebLN, switchActiveWallet } = useWallet()
  const { isBeta, isBetaLoading } = useBetaMode()

  const [refreshing, setRefreshing] = useState(false)
  const [creatingWallet, setCreatingWallet] = useState(false)
  const [filterTab, setFilterTab] = useState('all')
  const [timeFilter, setTimeFilter] = useState<TimeFilter>('all')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)

  const pubkey = localStorage.getItem('pubkey') ?? ''

  const { data: transactions = [], isLoading: loadingTx } = useWalletTransactions(pubkey)
  const { data: tickets = [] } = useWalletTickets(pubkey)
  const { data: subWalletResult, isLoading: loadingSubWallets } = useSubWallets(pubkey)
  const subWallets = subWalletResult?.subWallets ?? []
  const subWalletWarning = subWalletResult?.warning ?? false
  const subWalletLimitReached = subWalletResult?.limitReached ?? false
  // FU-240-E: nudge users who hold a wallet but no public receiving address.
  const { data: lnAddressInfo } = useLnAddress(pubkey || null)
  const showReceiveNudge = !isBeta && !isBetaLoading && Boolean(wallet) && Boolean(lnAddressInfo) && !lnAddressInfo?.handle

  const handleRefresh = useCallback(async () => {
    setRefreshing(true)
    try {
      await refreshBalance()
    } finally {
      setRefreshing(false)
    }
  }, [refreshBalance])

  const handleCreateWallet = useCallback(async () => {
    setCreatingWallet(true)
    try {
      await createWallet()
    } finally {
      setCreatingWallet(false)
    }
  }, [createWallet])

  const filteredTransactions = useMemo(() => {
    if (filterTab === 'all') return transactions
    if (filterTab === 'OPEN') return transactions.filter(isOpenTransaction)
    return transactions.filter(tx => tx.type === filterTab)
  }, [transactions, filterTab])

  const timeFilteredTransactions = useMemo(() => {
    if (timeFilter === 'all') return filteredTransactions
    
    const now = new Date()
    const filterDate = new Date()
    
    switch (timeFilter) {
      case '1m':
        filterDate.setMonth(now.getMonth() - 1)
        break
      case '3m':
        filterDate.setMonth(now.getMonth() - 3)
        break
      case '1y':
        filterDate.setFullYear(now.getFullYear() - 1)
        break
    }
    
    return filteredTransactions.filter(tx => new Date(tx.createdAt) >= filterDate)
  }, [filteredTransactions, timeFilter])

  const summaryStats = useMemo(() => {
    const sent = timeFilteredTransactions.filter(tx => tx.type === 'SENT')
    const received = timeFilteredTransactions.filter(tx => tx.type === 'RECEIVED')
    return {
      totalSent: sent.reduce((sum, tx) => sum + tx.amountSats, 0),
      totalReceived: received.reduce((sum, tx) => sum + tx.amountSats, 0),
      countSent: sent.length,
      countReceived: received.length,
    }
  }, [timeFilteredTransactions])

  const totalPages = Math.max(1, Math.ceil(timeFilteredTransactions.length / pageSize))
  const paginatedTransactions = useMemo(
    () => timeFilteredTransactions.slice((page - 1) * pageSize, page * pageSize),
    [timeFilteredTransactions, page, pageSize],
  )

  useEffect(() => {
    if (page > totalPages) setPage(totalPages)
  }, [page, totalPages])

  useEffect(() => {
    setPage(1)
  }, [filterTab, pageSize, timeFilter])

  return (
    <PageContainer size="wide" spacing="lg" className="!mt-0">
      <PageHeader
        icon={<WalletIcon sx={{ fontSize: 24 }} />}
        title="Wallet"
        subtitle="Lightning balance, transactions and escrow"
        onBack={() => navigate('/')}
      />

      <div className="flex flex-col gap-5">
        <PriceStrip />

        <div className="flex flex-col md:flex-row gap-4">
          <div className="flex-1 min-w-0">
            {wallet ? (
              <BalanceCard wallet={wallet} onRefresh={handleRefresh} refreshing={refreshing || walletLoading} />
            ) : isBetaLoading ? (
              <div
                className="h-40 rounded-xl animate-pulse"
                style={{ background: 'var(--theme-surface)' }}
              />
            ) : isBeta ? (
              <WalletCreateCard variant="beta" isCreating={creatingWallet} onCreate={handleCreateWallet} />
            ) : (
              <WalletCreateCard variant="production" onOpenSettings={() => navigate('/settings#wallet')} />
            )}
          </div>

          <div className="flex flex-col gap-3 w-full md:w-72 shrink-0">
            {wallet && (
              <MultiWalletSwitcher
                wallets={wallets}
                activeWalletId={wallet.id}
                onSelect={switchActiveWallet}
                onConnectWebLN={connectWebLN}
              />
            )}

            <div
              className="flex flex-col gap-2 p-3 rounded-xl border"
              style={{ border: '1px solid var(--theme-border)', background: 'var(--theme-surface)' }}
            >
              <span className="text-[11px] uppercase font-semibold tracking-wider" style={{ color: 'var(--theme-text-muted)' }}>
                Quick Actions
              </span>
              <button
                type="button"
                onClick={() => navigate('/wallet/send')}
                className={cn(
                  'flex items-center justify-between px-3 py-2.5 rounded-lg text-[13px] font-semibold transition-all duration-150',
                  'hover:bg-[var(--theme-surface-secondary)] active:scale-[0.98]',
                )}
                style={{ border: '1px solid var(--theme-border)', color: 'var(--theme-text)' }}
              >
                <span className="flex items-center gap-2">
                  <SendIcon sx={{ fontSize: 14 }} style={{ color: 'var(--color-primary-50)' }} />
                  Send
                </span>
                <ArrowForwardIcon sx={{ fontSize: 14 }} style={{ color: 'var(--theme-text-muted)' }} />
              </button>
              {cartTotalSats > 0 && (
                <div
                  className="flex items-center gap-2 px-3 py-2.5 rounded-lg text-[13px] font-semibold"
                  style={{ background: 'rgba(232,69,65,0.08)', color: 'var(--color-primary-50)' }}
                >
                  <ShoppingCartIcon sx={{ fontSize: 14 }} />
                  Cart: {cartTotalSats.toLocaleString()} sats
                </div>
              )}
            </div>
          </div>
        </div>

        {tickets.length > 0 && (
          <EscrowStatusPanel
            tickets={tickets}
            onTicketClick={id => navigate(`/tickets/${id}`)}
          />
        )}

        {showReceiveNudge && (
          <button
            type="button"
            onClick={() => navigate('/settings#wallet')}
            className={cn(
              'flex items-center gap-3 p-3.5 rounded-xl border text-left transition-all duration-150',
              'hover:-translate-y-0.5 active:scale-[0.99] cursor-pointer',
            )}
            style={{ border: '1px solid var(--theme-border)', background: 'var(--theme-surface)' }}
          >
            <div
              className="flex items-center justify-center w-9 h-9 rounded-lg shrink-0"
              style={{ background: 'rgba(232,69,65,0.10)', color: 'var(--color-btc)' }}
            >
              <WalletIcon sx={{ fontSize: 18 }} />
            </div>
            <div className="flex flex-col min-w-0 flex-1">
              <span className="text-[13px] font-semibold" style={{ color: 'var(--theme-text)' }}>
                Get a public Lightning address
              </span>
              <span className="text-[12px]" style={{ color: 'var(--theme-text-muted)' }}>
                Make it easy for buyers to pay you — pick a handle in Settings → Wallet. Colabonate never holds your funds.
              </span>
            </div>
            <ArrowForwardIcon sx={{ fontSize: 16, color: 'var(--theme-text-muted)' }} />
          </button>
        )}

        <SubWalletPanel
          subWallets={subWallets}
          loading={loadingSubWallets}
          onOfferClick={id => navigate(`/offers/${id}`)}
          warning={subWalletWarning}
          limitReached={subWalletLimitReached}
        />

        <CashuPanel />

        <NwcPanel />

        <div className="flex flex-col gap-3">
          <ListHeader
            tabs={TX_TABS}
            activeTab={filterTab}
            onTabChange={(key) => setFilterTab(key)}
            actions={[
              {
                key: 'page-size',
                element: (
                  <select
                    value={pageSize}
                    onChange={e => setPageSize(Number(e.target.value))}
                    className="rounded-lg outline-none cursor-pointer"
                    style={{
                      fontSize: 12,
                      height: 36,
                      padding: '0 10px',
                      background: 'var(--theme-bg-subtle)',
                      color: 'var(--theme-text-muted)',
                      border: '1px solid var(--theme-border)',
                    }}
                  >
                    <option value={5}>5 / page</option>
                    <option value={10}>10 / page</option>
                    <option value={25}>25 / page</option>
                    <option value={50}>50 / page</option>
                  </select>
                ),
              },
            ]}
          />

          {loadingTx ? (
            <div className="flex flex-col gap-2">
              {[1, 2, 3].map(i => (
                <div
                  key={i}
                  className="h-16 rounded-xl animate-pulse"
                  style={{ background: 'var(--theme-surface)' }}
                />
              ))}
            </div>
          ) : timeFilteredTransactions.length === 0 ? (
            <div
              className="flex flex-col items-center gap-2 py-8 rounded-xl border"
              style={{ border: '1px solid var(--theme-border)', color: 'var(--theme-text-muted)' }}
            >
              <WalletIcon sx={{ fontSize: 24 }} />
              <span className="text-[13px]">No orders or payments yet</span>
              <span className="text-[11px] px-6 text-center">
                This history comes from your tickets — purchases, sales and escrow.
              </span>
            </div>
          ) : (
            <>
              <TransactionSummary
                totalSent={summaryStats.totalSent}
                totalReceived={summaryStats.totalReceived}
                countSent={summaryStats.countSent}
                countReceived={summaryStats.countReceived}
                timeFilter={timeFilter}
                onTimeFilterChange={setTimeFilter}
              />

              <div className="flex flex-col gap-2">
                {paginatedTransactions.map(tx => (
                  <TransactionCard
                    key={tx.id}
                    transaction={tx}
                    onClick={id => navigate(`/tickets/${id}`)}
                  />
                ))}
              </div>

              {totalPages > 1 && (
                <div
                  className="flex items-center justify-between px-3 py-2 rounded-xl border"
                  style={{ border: '1px solid var(--theme-border)', background: 'var(--theme-surface)' }}
                >
                  <span className="text-[12px]" style={{ color: 'var(--theme-text-muted)' }}>
                    {((page - 1) * pageSize) + 1}–{Math.min(page * pageSize, timeFilteredTransactions.length)} of {timeFilteredTransactions.length}
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setPage(p => Math.max(1, p - 1))}
                      disabled={page === 1}
                      className={cn(
                        'flex items-center justify-center rounded-lg transition-all duration-150',
                        page === 1 ? 'opacity-40 cursor-not-allowed' : 'hover:bg-[var(--theme-surface-secondary)] cursor-pointer',
                      )}
                      style={{ width: 32, height: 32, border: '1px solid var(--theme-border)', color: 'var(--theme-text-muted)' }}
                    >
                      <ChevronLeftIcon sx={{ fontSize: 14 }} />
                    </button>
                    {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
                      const p = i + 1
                      return (
                        <button
                          key={p}
                          type="button"
                          onClick={() => setPage(p)}
                          className="flex items-center justify-center rounded-lg text-[12px] font-semibold transition-all duration-150"
                          style={{
                            width: 32, height: 32,
                            background: page === p ? 'var(--color-primary-50)' : 'var(--theme-bg-subtle)',
                            color: page === p ? 'white' : 'var(--theme-text-muted)',
                            border: '1px solid var(--theme-border)',
                          }}
                        >
                          {p}
                        </button>
                      )
                    })}
                    <button
                      type="button"
                      onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                      disabled={page === totalPages}
                      className={cn(
                        'flex items-center justify-center rounded-lg transition-all duration-150',
                        page === totalPages ? 'opacity-40 cursor-not-allowed' : 'hover:bg-[var(--theme-surface-secondary)] cursor-pointer',
                      )}
                      style={{ width: 32, height: 32, border: '1px solid var(--theme-border)', color: 'var(--theme-text-muted)' }}
                    >
                      <ChevronRightIcon sx={{ fontSize: 14 }} />
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </PageContainer>
  )
}
