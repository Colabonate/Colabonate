// @vitest-environment jsdom
import '../../../test/setup-component-tests'
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { CreateCatalogModal } from './CatalogModals'

// CreateCatalogModal renders through createPortal + router <Link> — wrap in
// MemoryRouter. The useStandardCategoryTree fetch fails silently in jsdom
// (hook has its own try/catch), which is fine: these tests exercise the
// company-guard notice and the disabled submit button, not the category tree.
function renderModal(props: { companyId?: string | null } = {}) {
  return render(
    <MemoryRouter>
      <CreateCatalogModal
        companyId={props.companyId ?? null}
        defaultType="PRODUCT"
        onClose={() => {}}
        onCreated={() => {}}
      />
    </MemoryRouter>,
  )
}

async function typeName(value: string) {
  const user = userEvent.setup()
  await user.type(screen.getByLabelText(/Catalog Name/), value)
}

function submitButton() {
  return screen.getByRole('button', { name: /create catalog/i })
}

describe('CreateCatalogModal — company guard', () => {
  it('shows the create-company hint when PRODUCT is selected without a company', () => {
    renderModal({ companyId: null })
    const hint = screen.getByRole('note')
    expect(hint).toHaveTextContent(/Product catalogs require an active company profile/)
    const link = screen.getByRole('link', { name: /Create your company/ })
    expect(link).toHaveAttribute('href', '/sell/company')
  })

  it('keeps the submit button disabled with a filled name while no company exists', async () => {
    renderModal({ companyId: null })
    await typeName('Summer Collection 2026')
    expect(submitButton()).toBeDisabled()
  })

  it('enables the submit button with a filled name once a company exists and hides the hint', async () => {
    renderModal({ companyId: 'company-1' })
    expect(screen.queryByRole('note')).not.toBeInTheDocument()
    await typeName('Summer Collection 2026')
    expect(submitButton()).toBeEnabled()
  })
})
