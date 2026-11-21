import { useState, useCallback, useRef, useEffect, type RefObject } from 'react'
import { Box, Button, IconButton, Tooltip } from '@mui/material'
import ArrowForwardIcon from '@mui/icons-material/ArrowForward'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import { cn } from '@ds/utils'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface FormStep {
  id: number
  label: string
  description?: string
}

export interface FormStepperProps {
  steps: FormStep[]
  currentStep: number
  onStepChange: (step: number) => void
  children: React.ReactNode[]
  onContinue?: (step: number) => boolean | void
  /** ADR-330 D3: when provided, footer Back, ArrowLeft and swipe-back call it
   *  instead of the internal goPrev — the consumer owns back semantics (e.g.
   *  URL cleanup). Returning false blocks the navigation, mirroring onContinue. */
  onBack?: () => boolean | void
  onLastStepComplete?: () => void
  continueLabel?: string
  backLabel?: string
  showSkip?: boolean
  onSkip?: () => void
  skipLabel?: string
  className?: string
  contentClassName?: string
  allowBack?: boolean
  disabled?: boolean
  hideFooter?: boolean
  secondaryAction?: {
    label: string
    onClick: () => void
    disabled?: boolean
    /** When provided, render the action as an MUI IconButton with this icon.
     *  `label` is used as the accessible name and tooltip. */
    icon?: React.ReactNode
  }
  /** Ref to the error container of the current step — FormStepper scrolls here on validation error. */
  stepErrorAnchorRef?: RefObject<HTMLElement | null>
  /** Step indices the caller considers fully valid/complete (e.g. passed validation).
   *  Purely presentational — FormStepper does not compute this itself. */
  completedSteps?: number[]
}

// ─── Step colors ─────────────────────────────────────────────────────────────

const STEP_COLORS = [
  'rgba(107,177,255,1)',   // blue
  'rgba(232,69,65,1)',     // red
  'rgba(42,232,102,1)',    // green
]

// ─── Component ───────────────────────────────────────────────────────────────

export function FormStepper({
  steps,
  currentStep,
  onStepChange,
  children,
  onContinue,
  onBack,
  onLastStepComplete,
  continueLabel = 'Continue',
  backLabel = 'Back',
  showSkip = false,
  onSkip,
  skipLabel = 'Skip',
  className,
  contentClassName,
  allowBack = true,
  disabled = false,
  hideFooter = false,
  secondaryAction,
  stepErrorAnchorRef,
  completedSteps,
}: FormStepperProps) {
  const [direction, setDirection] = useState<'next' | 'prev'>('next')
  const [isAnimating, setIsAnimating] = useState(false)
  const touchStartX = useRef<number | null>(null)
  const touchStartY = useRef<number | null>(null)
  const contentRef = useRef<HTMLDivElement>(null)

  const totalSteps = steps.length
  const step = steps[currentStep]
  const isFirst = currentStep === 0
  const isLast = currentStep === totalSteps - 1
  const progress = ((currentStep + 1) / totalSteps) * 100
  const stepColor = STEP_COLORS[currentStep % STEP_COLORS.length] ?? 'var(--color-primary-50)'

  const goToStep = useCallback(
    (index: number, dir: 'next' | 'prev' = 'next') => {
      if (isAnimating) return
      if (index < 0 || index >= totalSteps) return
      setDirection(dir)
      setIsAnimating(true)
      onStepChange(index)
      contentRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      setTimeout(() => setIsAnimating(false), 350)
    },
    [totalSteps, isAnimating, onStepChange],
  )

  const goNext = useCallback(() => goToStep(currentStep + 1, 'next'), [currentStep, goToStep])
  const goPrev = useCallback(() => goToStep(currentStep - 1, 'prev'), [currentStep, goToStep])

  const handleBack = useCallback(() => {
    if (onBack) {
      onBack()
      return
    }
    goPrev()
  }, [onBack, goPrev])

  const handleContinue = useCallback(() => {
    if (onContinue) {
      const canContinue = onContinue(currentStep)
      if (canContinue === false) {
        // ADR-213 C3: scroll to the step's error container if provided.
        stepErrorAnchorRef?.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
        return
      }
    }
    if (isLast) {
      onLastStepComplete?.()
      return
    }
    goNext()
  }, [isLast, goNext, onContinue, currentStep, onLastStepComplete, stepErrorAnchorRef])

  const handleSkip = useCallback(() => {
    onSkip?.()
  }, [onSkip])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (disabled) return
      // ADR-213 C3: ignore keyboard navigation when focus is inside a form field
      // to prevent the mobile keyboard's Enter/Done key from advancing the stepper.
      const target = e.target as HTMLElement
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable
      ) return
      if (e.key === 'ArrowRight' || e.key === 'Enter') handleContinue()
      if (e.key === 'ArrowLeft' && allowBack) handleBack()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleContinue, handleBack, allowBack, disabled])

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX
    touchStartY.current = e.touches[0].clientY
  }

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current === null || touchStartY.current === null || disabled) return
    const diffX = touchStartX.current - e.changedTouches[0].clientX
    const diffY = Math.abs(touchStartY.current - e.changedTouches[0].clientY)
    // ADR-213 C3: require horizontal swipe to dominate vertical travel (ratio > 1.5)
    // and raise threshold to 80 px to avoid accidental navigation on mobile.
    if (Math.abs(diffX) > 80 && Math.abs(diffX) > diffY * 1.5) {
      if (diffX > 0 && !isLast) goNext()
      else if (diffX < 0 && allowBack && !isFirst) handleBack()
    }
    touchStartX.current = null
    touchStartY.current = null
  }

  const slideAnimClass = direction === 'next' ? 'animate-slide-in-next' : 'animate-slide-in-prev'

  return (
    <div
      className={cn('flex flex-col', className)}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      {/* ── Progress Bar ──────────────────────────────────────────── */}
      <div className="mb-4">
        <div
          className="h-1 overflow-hidden rounded-full"
          style={{ background: disabled ? 'var(--theme-text-muted)' : 'var(--theme-border)', opacity: disabled ? 0.3 : 1 }}
        >
          <div
            className="h-full transition-all duration-500 ease-out rounded-full"
            style={{
              width: `${progress}%`,
              background: stepColor,
              opacity: disabled ? 0.4 : 1,
            }}
          />
        </div>
      </div>

      {/* ── Step Indicator ─────────────────────────────────────── */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <span
            className="text-[11px] font-bold uppercase tracking-widest"
            style={{ color: disabled ? 'var(--theme-text-muted)' : stepColor, opacity: disabled ? 0.5 : 1 }}
          >
            {step.label}
          </span>
          {step.description && (
            <span
              className="text-[11px]"
              style={{ color: 'var(--theme-text-muted)', opacity: disabled ? 0.5 : 1 }}
            >
              · {step.description}
            </span>
          )}
        </div>
        <span
          className="text-[11px] font-medium uppercase tracking-widest"
          style={{ color: 'var(--theme-text-muted)', opacity: disabled ? 0.5 : 1 }}
        >
          {currentStep + 1} / {totalSteps}
        </span>
      </div>

      {/* ── Dot Indicators ─────────────────────────────────────── */}
        <div className="flex items-center justify-center gap-2 mb-6">
        {steps.map((_, idx) => {
          const dotColor = disabled
            ? 'var(--theme-text-muted)'
            : STEP_COLORS[idx % STEP_COLORS.length] ?? 'var(--color-primary-50)'
          const isCompleted = idx !== currentStep && !disabled && (completedSteps?.includes(idx) ?? false)
          if (isCompleted) {
            return (
              <div
                key={idx}
                className="step-complete-pop"
                style={{
                  width: 16,
                  height: 16,
                  borderRadius: '50%',
                  background: 'var(--color-status-success)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                <svg width="9" height="7" viewBox="0 0 12 9" fill="none">
                  <path d="M1 4.5L4.5 8L11 1" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>
            )
          }
          return (
            <div
              key={idx}
              className={cn(
                'rounded-full transition-all duration-300',
                idx === currentStep ? 'w-6 h-2' : 'w-2 h-2',
                disabled ? 'opacity-40' : '',
              )}
              style={{
                background: dotColor,
                opacity: disabled && idx !== currentStep ? 0.3 : 1,
              }}
            />
          )
        })}
      </div>

      {/* ── Slide Content ──────────────────────────────────────── */}
      <div
        ref={contentRef}
        className={cn('flex-1', contentClassName)}
        style={{ minHeight: 0 }}
      >
        {children.map((child, idx) => (
          <div
            key={idx}
            className={cn(idx === currentStep ? slideAnimClass : '')}
            style={{ display: idx === currentStep ? 'block' : 'none' }}
            aria-hidden={idx !== currentStep}
          >
            {child}
          </div>
        ))}
      </div>

      {/* ── Footer Actions ─────────────────────────────────────── */}
      {!hideFooter && (
      <div className="flex items-center mt-6 gap-3">
        {allowBack && !isFirst && !disabled && (
          <Button
            variant="outlined"
            onClick={handleBack}
            startIcon={<ArrowBackIcon sx={{ fontSize: 18 }} />}
            sx={{ minWidth: 100 }}
          >
            {backLabel}
          </Button>
        )}

        {showSkip && !isLast && !disabled && (
          <Button
            variant="text"
            onClick={handleSkip}
            sx={{ minWidth: 80, color: 'text.secondary' }}
          >
            {skipLabel}
          </Button>
        )}

        <Box sx={{ flex: 1 }} />

        {secondaryAction && (
          secondaryAction.icon ? (
            <Tooltip title={secondaryAction.label} arrow>
              <span>
                <IconButton
                  aria-label={secondaryAction.label}
                  onClick={secondaryAction.onClick}
                  disabled={disabled || secondaryAction.disabled}
                  color="primary"
                >
                  {secondaryAction.icon}
                </IconButton>
              </span>
            </Tooltip>
          ) : (
            <Button
              variant="outlined"
              onClick={secondaryAction.onClick}
              disabled={disabled || secondaryAction.disabled}
              sx={{ minWidth: 120 }}
            >
              {secondaryAction.label}
            </Button>
          )
        )}

        <Button
          variant="contained"
          onClick={handleContinue}
          disabled={disabled}
          endIcon={!isLast && !disabled ? <ArrowForwardIcon sx={{ fontSize: 18 }} /> : undefined}
          sx={{ minWidth: 140, opacity: disabled ? 0.5 : 1 }}
        >
          {isLast ? (continueLabel !== 'Continue' ? continueLabel : 'Done') : continueLabel}
        </Button>
      </div>
      )}

      {/* ── Inline Animation Styles ─────────────────────────────── */}
      <style>{`
        @keyframes slideInNext {
          from { opacity: 0; transform: translateX(24px); }
          to   { opacity: 1; transform: translateX(0); }
        }
        @keyframes slideInPrev {
          from { opacity: 0; transform: translateX(-24px); }
          to   { opacity: 1; transform: translateX(0); }
        }
        .animate-slide-in-next { animation: slideInNext 0.35s ease-out; }
        .animate-slide-in-prev { animation: slideInPrev 0.35s ease-out; }
        @keyframes step-complete-pop {
          0%   { opacity: 0; scale: 0.5; }
          60%  { opacity: 1; scale: 1.08; }
          100% { opacity: 1; scale: 1; }
        }
        .step-complete-pop { animation: step-complete-pop 300ms cubic-bezier(0.34, 1.56, 0.64, 1) both; }
      `}</style>
    </div>
  )
}
