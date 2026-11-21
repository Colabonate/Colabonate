import type { HTMLAttributes } from 'react'
import { forwardRef } from 'react'
import { cn } from '@ds/utils'

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: 'base' | 'interactive' | 'elevated'
}

export const Card = forwardRef<HTMLDivElement, CardProps>(
  ({ variant = 'base', className = '', children, ...props }, ref) => {
    const baseStyles = cn(
      'rounded-lg p-6',
      'border',
      'bg-(--theme-surface)',
      'border-(--theme-border)'
    )
    
    const variantStyles = {
      base: 'shadow-sm',
      interactive: 'shadow-sm hover:shadow-md cursor-pointer transition-shadow',
      elevated: 'shadow-lg',
    }

    return (
      <div
        ref={ref}
        className={`${baseStyles} ${variantStyles[variant]} ${className}`}
        {...props}
      >
        {children}
      </div>
    )
  }
)

Card.displayName = 'Card'
