import { useState, type FormEvent } from 'react'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { Input } from '../../components/ui/Input'
import type { CreateTicketInput, TicketType, TicketPriority } from '../../types/ticket'

interface TicketCreationFormProps {
  onSubmit: (data: CreateTicketInput) => Promise<void>
  onCancel: () => void
  initialType?: TicketType
}

type FormStep = 'basic' | 'details' | 'review'

export function TicketCreationForm({ onSubmit, onCancel, initialType = 'transaction' }: TicketCreationFormProps) {
  const [currentStep, setCurrentStep] = useState<FormStep>('basic')
  const [loading, setLoading] = useState(false)
  const [formData, setFormData] = useState<CreateTicketInput>({
    title: '',
    description: '',
    type: initialType,
    priority: 'medium',
  })
  const [errors, setErrors] = useState<Partial<Record<keyof CreateTicketInput, string>>>({})

  const validateStep = (step: FormStep): boolean => {
    const newErrors: typeof errors = {}

    if (step === 'basic') {
      if (!formData.title.trim()) {
        newErrors.title = 'Title is required'
      } else if (formData.title.length < 5) {
        newErrors.title = 'Title must be at least 5 characters long'
      }
      if (!formData.description.trim()) {
        newErrors.description = 'Description is required'
      } else if (formData.description.length < 10) {
        newErrors.description = 'Description must be at least 10 characters long'
      }
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleNext = () => {
    if (validateStep(currentStep)) {
      setCurrentStep(currentStep === 'basic' ? 'details' : 'review')
    }
  }

  const handleBack = () => {
    setCurrentStep(currentStep === 'review' ? 'details' : 'basic')
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!validateStep('details')) return

    setLoading(true)
    try {
      await onSubmit(formData)
    } catch {
      setErrors({ title: 'Error creating ticket' })
    } finally {
      setLoading(false)
    }
  }

  const renderStepIndicator = () => {
    const steps: FormStep[] = ['basic', 'details', 'review']
    const currentIndex = steps.indexOf(currentStep)
    const stepLabels = ['Basic', 'Details', 'Review']

    return (
      <div 
        className="flex items-center gap-2 mb-6"
        role="progressbar"
        aria-valuenow={currentIndex + 1}
        aria-valuemin={1}
        aria-valuemax={3}
        aria-label="Ticket creation progress"
      >
        {steps.map((step, index) => (
          <div key={step} className="flex items-center">
            <div
              className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
                index <= currentIndex
                  ? 'bg-primary-600 text-white'
                  : 'bg-neutral-200 text-neutral-500'
              }`}
              aria-current={index === currentIndex ? 'step' : undefined}
              aria-label={`Step ${index + 1}: ${stepLabels[index]}`}
            >
              {index + 1}
            </div>
            {index < steps.length - 1 && (
              <div className={`w-12 h-0.5 ${index < currentIndex ? 'bg-primary-600' : 'bg-neutral-200'}`} />
            )}
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto">
      <Card>
        <h2 className="mb-4 text-2xl font-bold">Create new ticket</h2>
        
        {renderStepIndicator()}

        <form onSubmit={handleSubmit}>
          {currentStep === 'basic' && (
            <div className="space-y-4">
              <Input
                label="Title *"
                value={formData.title}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFormData({ ...formData, title: e.target.value })}
                error={errors.title}
                placeholder="e.g. Order #12345"
                autoFocus
              />

              <div>
                <label className="block mb-1 text-sm font-medium text-neutral-700">
                  Description *
                </label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  className={`w-full px-4 py-2 border rounded-md focus:ring-2 focus:ring-primary-500 focus:border-primary-500 ${
                    errors.description ? 'border-error-500' : 'border-neutral-300'
                  }`}
                  rows={4}
                  placeholder="Describe the issue..."
                />
                {errors.description && (
                  <p className="mt-1 text-sm text-error-500">{errors.description}</p>
                )}
              </div>

              <div>
                <label className="block mb-1 text-sm font-medium text-neutral-700">
                  Type
                </label>
                <select
                  value={formData.type}
                  onChange={(e) => setFormData({ ...formData, type: e.target.value as TicketType })}
                  className="w-full px-4 py-2 border rounded-md border-neutral-300 focus:ring-2 focus:ring-primary-500"
                >
                  <option value="transaction">Transaction</option>
                  <option value="cooperation">Cooperation</option>
                  <option value="dispute">Dispute</option>
                  <option value="general">General</option>
                </select>
              </div>
            </div>
          )}

          {currentStep === 'details' && (
            <div className="space-y-4">
              <div>
                <label className="block mb-1 text-sm font-medium text-neutral-700">
                  Priority
                </label>
                <select
                  value={formData.priority}
                  onChange={(e) => setFormData({ ...formData, priority: e.target.value as TicketPriority })}
                  className="w-full px-4 py-2 border rounded-md border-neutral-300 focus:ring-2 focus:ring-primary-500"
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
              </div>

              {/* Additional fields for offer linkage could go here */}
              <div className="p-4 rounded-md bg-neutral-50">
                <p className="text-sm text-neutral-600">
                  <strong>Note:</strong> This ticket will be linked to your Lightning identity.
                </p>
              </div>
            </div>
          )}

          {currentStep === 'review' && (
            <div className="space-y-4">
              <div className="p-4 space-y-2 rounded-md bg-neutral-50">
                <div>
                  <span className="text-sm font-medium text-neutral-500">Title</span>
                  <p className="text-neutral-900">{formData.title}</p>
                </div>
                <div>
                  <span className="text-sm font-medium text-neutral-500">Description</span>
                  <p className="text-neutral-900">{formData.description}</p>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <span className="text-sm font-medium text-neutral-500">Type</span>
                    <p className="capitalize text-neutral-900">{formData.type}</p>
                  </div>
                  <div>
                    <span className="text-sm font-medium text-neutral-500">Priority</span>
                    <p className="capitalize text-neutral-900">{formData.priority}</p>
                  </div>
                </div>
              </div>
            </div>
          )}

          <div className="flex justify-between mt-6">
            {currentStep !== 'basic' ? (
              <Button type="button" variant="outline" onClick={handleBack}>
                Back
              </Button>
            ) : (
              <Button type="button" variant="ghost" onClick={onCancel}>
                Cancel
              </Button>
            )}

            {currentStep === 'review' ? (
              <Button type="submit" variant="primary" loading={loading}>
                Create ticket
              </Button>
            ) : (
              <Button type="button" variant="primary" onClick={handleNext}>
                Continue
              </Button>
            )}
          </div>
        </form>
      </Card>
    </div>
  )
}
