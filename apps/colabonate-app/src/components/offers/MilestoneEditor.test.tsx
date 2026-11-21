// @vitest-environment jsdom
import '../../test/setup-component-tests'
import { useState } from 'react'
import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MilestoneEditor, type MilestoneEditorProps } from './MilestoneEditor'
import type { MilestoneFormItem } from './offerFormConstants'

// MilestoneEditor is fully controlled (onMilestonesChange only receives
// setState-style updaters) — a small stateful harness is needed to exercise
// real add/remove/update behavior instead of inspecting updater-function
// internals.
function Harness({
  initial,
  ...props
}: Omit<MilestoneEditorProps, 'milestones' | 'onMilestonesChange'> & { initial: MilestoneFormItem[] }) {
  const [milestones, setMilestones] = useState(initial)
  return <MilestoneEditor milestones={milestones} onMilestonesChange={setMilestones} {...props} />
}

const one: MilestoneFormItem[] = [{ title: '', description: '', percentage: 50 }]
const two: MilestoneFormItem[] = [
  { title: 'Design', description: '', percentage: 50 },
  { title: 'Build', description: '', percentage: 50 },
]

describe('MilestoneEditor', () => {
  it('shows the total allocation with no remaining/over hint at exactly 100%', () => {
    render(<Harness initial={two} />)
    // The "Total allocation" status region is the single source of truth for
    // the running sum — scoped separately from the "Set 100%" preset button,
    // which also renders the literal text "100%".
    const status = within(screen.getByRole('status'))
    expect(status.getByText('100%')).toBeInTheDocument()
    expect(status.queryByText(/remaining|over/)).not.toBeInTheDocument()
  })

  it('flags a non-100% allocation with the remaining/over hint', () => {
    render(<Harness initial={[{ title: 'A', description: '', percentage: 25 }]} />)
    expect(screen.getByText(/25%.*75% remaining/)).toBeInTheDocument()
  })

  it('adds a new milestone when "+ Add milestone" is clicked', async () => {
    const user = userEvent.setup()
    render(<Harness initial={one} />)
    // MUI's `required` prop appends its own asterisk after the label prop —
    // matching the base label as a prefix avoids depending on that markup.
    expect(screen.getAllByLabelText(/^Title/)).toHaveLength(1)
    await user.click(screen.getByRole('button', { name: '+ Add milestone' }))
    expect(screen.getAllByLabelText(/^Title/)).toHaveLength(2)
  })

  it('removes a milestone via its Delete button, only shown when more than one exists', async () => {
    const user = userEvent.setup()
    render(<Harness initial={two} />)
    expect(screen.getByRole('button', { name: 'Delete milestone 1' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Delete milestone 1' }))
    expect(screen.getAllByLabelText(/^Title/)).toHaveLength(1)
    // The sole remaining milestone has no Delete button — the editor never
    // lets the list go empty.
    expect(screen.queryByRole('button', { name: /delete milestone/i })).not.toBeInTheDocument()
  })

  it('sets a milestone\'s percentage via the quick-share presets', async () => {
    const user = userEvent.setup()
    render(<Harness initial={one} />)
    await user.click(screen.getByRole('button', { name: 'Set 100%' }))
    expect(screen.getByLabelText(/^%/)).toHaveValue(100)
    expect(within(screen.getByRole('status')).getByText('100%')).toBeInTheDocument()
  })

  it('updates the title field and reflects it in the collapsed-header preview', async () => {
    const user = userEvent.setup()
    render(<Harness initial={one} />)
    await user.type(screen.getByLabelText(/^Title/), 'Kickoff payment')
    expect(screen.getByText('Kickoff payment')).toBeInTheDocument()
  })
})
