import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { PageContainer } from '@ds/ui'
import { NotFoundState } from '../../components/NotFoundState'
import { usePageAnimation } from '../../hooks/usePageAnimation'
import { useCompanyById } from '../../hooks/useEntityQueries'
import { useEntityOwnedContent } from '../../hooks/useEntityOwnedContent'
import { apiCall } from '../../lib/api'
import { CompanyBlock } from '../../components/profile/CompanyBlock'
import { EntityContentList } from '../../components/profile/EntityContentList'
import { ArrowLeft } from 'lucide-react'
import CircularProgress from '@mui/material/CircularProgress'
import StorefrontIcon from '@mui/icons-material/Storefront'

export function CompanyProfile() {
  const { companyId } = useParams<{ companyId: string }>()
  const navigate = useNavigate()
  const [ownerLnAddress, setOwnerLnAddress] = useState<string | null>(null)

  const pageRef = usePageAnimation([
    { selector: '.page-animate', from: { duration: 0.5, y: 20 } },
  ])

  const { data: company, isLoading: companyLoading } = useCompanyById(companyId ?? '')
  const { items: ownedItems, loading: ownedLoading } = useEntityOwnedContent(company?.ownerPubkey ?? '', company?.id)
  const loading = companyLoading || ownedLoading

  const fetchOwnerProfile = useCallback(async (pubkey: string) => {
    try {
      const res = await apiCall(`/api/user/${pubkey}/profile`)
      const data = await res.json()
      if (data?.lnAddress) setOwnerLnAddress(data.lnAddress)
    } catch {
      setOwnerLnAddress(null)
    }
  }, [])

  useEffect(() => {
    if (company?.ownerPubkey) {
      fetchOwnerProfile(company.ownerPubkey)
    } else {
      setOwnerLnAddress(null)
    }
  }, [company?.ownerPubkey, fetchOwnerProfile])

  if (loading) {
    return (
      <PageContainer size="narrow" spacing="lg" className="pt-0!">
        <div className="flex items-center justify-center min-h-[60vh]">
          <div className="flex flex-col items-center gap-4">
            <CircularProgress />
            <span className="text-[var(--theme-text-muted)] text-sm">Loading company…</span>
          </div>
        </div>
      </PageContainer>
    )
  }

  if (!company) {
    return (
      <NotFoundState
        icon={<StorefrontIcon sx={{ fontSize: { xs: 44, sm: 52 } }} />}
        title="Company not found"
        message="This company may have been removed, or the link is incorrect."
        detail={companyId ? `Company ${companyId}` : undefined}
        primary={{ label: 'Back to partners', to: '/coop?filter=partners' }}
        secondary={{ label: 'Go back', onClick: () => navigate(-1) }}
      />
    )
  }

  return (
    <PageContainer size="narrow" spacing="lg" className="page-animate pt-0!" ref={pageRef}>
      <button
        onClick={() => navigate(-1)}
        className="inline-flex items-center gap-2 mb-4 bg-transparent border-none text-[13px] cursor-pointer p-0 hover:text-[var(--color-primary-50)] transition-colors duration-200"
        style={{ color: 'var(--theme-text-muted)' }}
      >
        <ArrowLeft size={16} />
        Go back
      </button>

      <CompanyBlock
        company={company}
        owner={{ pubkey: company.ownerPubkey, displayName: ownerLnAddress }}
      />

      <EntityContentList items={ownedItems} loading={ownedLoading} />
    </PageContainer>
  )
}
