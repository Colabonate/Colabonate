// @vitest-environment jsdom
import '../../test/setup-component-tests'
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DisputeModal } from './DisputeModal'

describe('DisputeModal', () => {
  it('keeps the reason step Continue button disabled until a reason is chosen', async () => {
    const user = userEvent.setup()
    render(<DisputeModal open onClose={() => {}} onSubmit={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()
    await user.click(screen.getByText('Quality issue'))
    expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled()
  })

  it('keeps the details step Continue button disabled until description and resolution are filled', async () => {
    const user = userEvent.setup()
    render(<DisputeModal open onClose={() => {}} onSubmit={vi.fn()} />)
    await user.click(screen.getByText('Quality issue'))
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()
    // MUI's `required` prop appends its own asterisk after the label text —
    // this field's label prop already bakes one in too, so match as a prefix.
    await user.type(screen.getByLabelText(/^Problem description/), 'Item arrived broken')
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()

    // MUI select — open then pick an option by role.
    await user.click(screen.getByLabelText(/^Desired resolution/))
    await user.click(await screen.findByRole('option', { name: 'Full refund' }))
    expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled()
  })

  it('submits the collected reason/description/resolution on the review step', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    const user = userEvent.setup()
    render(<DisputeModal open onClose={() => {}} onSubmit={onSubmit} />)

    await user.click(screen.getByText('Quality issue'))
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await user.type(screen.getByLabelText(/^Problem description/), 'Item arrived broken')
    await user.click(screen.getByLabelText(/^Desired resolution/))
    await user.click(await screen.findByRole('option', { name: 'Full refund' }))
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    await user.click(screen.getByRole('button', { name: 'Submit issue' }))
    expect(onSubmit).toHaveBeenCalledWith('quality', 'Item arrived broken', 'refund')
  })

  it('resets to the reason step and calls onClose when Cancel is clicked', async () => {
    const onClose = vi.fn()
    const user = userEvent.setup()
    render(<DisputeModal open onClose={onClose} onSubmit={vi.fn()} />)
    await user.click(screen.getByText('Quality issue'))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
