import { useState } from 'react'
import {
  Alert,
  Box,
  Fade,
  MenuItem,
  Step,
  StepLabel,
  Stepper,
  TextField,
  Typography,
} from '@mui/material'
import ReportProblemIcon from '@mui/icons-material/ReportProblem'
import WarningAmberIcon  from '@mui/icons-material/WarningAmber'
import {
  Modal,
  ModalHeader,
  ModalContent,
  ModalActions,
} from '@ds/ui'

interface DisputeModalProps {
  open: boolean
  onClose: () => void
  onSubmit: (reason: string, description: string, desiredResolution: string) => Promise<void>
}

const disputeReasons = [
  { value: 'quality',      label: 'Quality issue',     description: 'Product does not match description' },
  { value: 'non-delivery', label: 'Not delivered',    description: 'Product was not received' },
  { value: 'wrong-item',   label: 'Wrong item',       description: 'Different product than ordered' },
  { value: 'damaged',      label: 'Damaged',          description: 'Product arrived damaged' },
  { value: 'late',         label: 'Late delivery',    description: 'Delivery arrived late' },
  { value: 'other',        label: 'Other',            description: 'Other issue' },
]

export const resolutionOptions = [
  { value: 'refund',         label: 'Full refund' },
  { value: 'partial-refund', label: 'Partial refund' },
  { value: 'replacement',    label: 'Replacement' },
  { value: 'repair',         label: 'Repair' },
  { value: 'other',          label: 'Other solution' },
]

const STEPS = ['Reason', 'Details', 'Review']

export function DisputeModal({ open, onClose, onSubmit }: DisputeModalProps) {
  const [step, setStep]                       = useState(0)
  const [reason, setReason]                   = useState('')
  const [description, setDescription]         = useState('')
  const [desiredResolution, setDesiredResolution] = useState('')
  const [submitting, setSubmitting]           = useState(false)

  const canNext = step === 0
    ? !!reason
    : step === 1
    ? !!description && !!desiredResolution
    : true

  function handleClose() {
    if (submitting) return
    setStep(0)
    setReason('')
    setDescription('')
    setDesiredResolution('')
    onClose()
  }

  async function handleSubmit() {
    if (!reason || !description || !desiredResolution) return
    setSubmitting(true)
    try {
      await onSubmit(reason, description, desiredResolution)
      handleClose()
    } catch (error) {
      console.error('Failed to submit dispute:', error)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={handleClose}
      size="sm"
      TransitionComponent={Fade}
      TransitionProps={{ timeout: 250 }}
    >
      <ModalHeader
        title={
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <ReportProblemIcon color="error" />
            <Typography variant="h6" fontWeight={700}>Report issue</Typography>
          </Box>
        }
        onClose={handleClose}
        hideCloseButton={submitting}
      />
      <ModalContent>
        {/* Stepper */}
        <Stepper activeStep={step} sx={{ mb: 3, mt: 1 }}>
          {STEPS.map((label) => (
            <Step key={label}>
              <StepLabel>{label}</StepLabel>
            </Step>
          ))}
        </Stepper>

        {/* Schritt 1: Grund wählen */}
        {step === 0 && (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            <Typography variant="body2" color="text.secondary" mb={1}>
              Choose the reason for the problem:
            </Typography>
            {disputeReasons.map((r) => (
              <Box
                key={r.value}
                onClick={() => setReason(r.value)}
                sx={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 1.5,
                  p: 1.75,
                  borderRadius: 1,
                  border: '1px solid',
                  borderColor: reason === r.value ? 'error.main' : 'divider',
                  bgcolor: reason === r.value ? 'rgba(218, 20, 20, 0.06)' : 'transparent',
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                  '&:hover': { borderColor: 'error.light' },
                }}
              >
                <Box
                  sx={{
                    width: 18,
                    height: 18,
                    borderRadius: '50%',
                    border: '2px solid',
                    borderColor: reason === r.value ? 'error.main' : 'text.disabled',
                    bgcolor: reason === r.value ? 'error.main' : 'transparent',
                    flexShrink: 0,
                    mt: 0.2,
                    transition: 'all 0.15s',
                  }}
                />
                <Box>
                  <Typography variant="body2" fontWeight={600}>{r.label}</Typography>
                  <Typography variant="caption" color="text.secondary">{r.description}</Typography>
                </Box>
              </Box>
            ))}
          </Box>
        )}

        {/* Schritt 2: Details */}
        {step === 1 && (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
            <TextField
              label="Problem description *"
              multiline
              rows={4}
              fullWidth
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe the problem in detail..."
              required
            />
            <TextField
              label="Desired resolution *"
              select
              fullWidth
              value={desiredResolution}
              onChange={(e) => setDesiredResolution(e.target.value)}
              required
            >
              {resolutionOptions.map((opt) => (
                <MenuItem key={opt.value} value={opt.value}>{opt.label}</MenuItem>
              ))}
            </TextField>
            <Alert severity="info" icon={false}>
              <Typography variant="caption">
                <strong>Note:</strong> After submission, the ticket will be locked and
                both parties have 72 hours to agree on a solution.
              </Typography>
            </Alert>
          </Box>
        )}

        {/* Schritt 3: Überprüfen */}
        {step === 2 && (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Box
              sx={{
                p: 2,
                borderRadius: 1,
                bgcolor: 'action.hover',
                display: 'flex',
                flexDirection: 'column',
                gap: 1.5,
              }}
            >
              {[
                { label: 'Reason', value: disputeReasons.find(r => r.value === reason)?.label },
                { label: 'Description', value: description },
                { label: 'Desired resolution', value: resolutionOptions.find(o => o.value === desiredResolution)?.label },
              ].map(({ label, value }) => (
                <Box key={label}>
                  <Typography variant="caption" color="text.secondary" fontWeight={600} display="block">
                    {label}
                  </Typography>
                  <Typography variant="body2" color="text.primary" sx={{ whiteSpace: 'pre-wrap' }}>
                    {value}
                  </Typography>
                </Box>
              ))}
            </Box>

            <Alert severity="error" icon={<WarningAmberIcon />}>
              <Typography variant="caption">
                <strong>Important:</strong> By submitting this dispute, the
                escrow payment will be frozen until a solution is found.
              </Typography>
            </Alert>
          </Box>
        )}
      </ModalContent>
      <ModalActions
        align="space-between"
        cancel={step > 0
          ? { onClick: () => setStep(s => s - 1), children: 'Back', disabled: submitting }
          : { onClick: handleClose, children: 'Cancel', disabled: submitting, hidden: false }
        }
        confirm={step < 2
          ? { onClick: () => setStep(s => s + 1), children: 'Continue', disabled: !canNext || submitting }
          : {
              onClick: handleSubmit,
              children: submitting ? 'Submitting…' : 'Submit issue',
              color: 'error',
              disabled: submitting,
              loading: submitting,
            }
        }
      />
    </Modal>
  )
}
