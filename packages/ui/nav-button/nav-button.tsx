import React from 'react';
import { cn } from '@ds/utils';

export interface NavButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Visual state of the button */
  variant?: 'default' | 'active' | 'hover';
  /** Size variant for the nav button */
  size?: 'small' | 'medium';
  /** Icon element to display above label */
  icon?: React.ReactNode;
  /** Label text displayed below icon */
  label?: string;
  /** Whether the button takes full available width */
  fullWidth?: boolean;
}

export function NavButton({
  variant = 'default',
  size = 'medium',
  icon,
  label,
  fullWidth = false,
  className,
  children,
  ...props
}: NavButtonProps) {
  const baseStyles = cn(
    'flex flex-col items-center justify-center gap-0.5',
    'bg-transparent border-0 cursor-pointer p-0',
    'font-[var(--typography-fontfamily-sans)]',
    'transition-colors duration-150 ease-out',
    fullWidth && 'flex-1',
    size === 'small' && 'min-w-[48px]',
    size === 'medium' && 'min-w-[56px]',
  );

  const iconColor = variant === 'active'
    ? 'var(--color-action-primary-default)'
    : variant === 'hover'
    ? 'var(--color-action-neutral-hover)'
    : 'var(--color-neutral-5)';

  const labelStyles = cn(
    'text-[11px] leading-[16px] uppercase whitespace-nowrap',
    'font-[var(--typography-fontfamily-sans)]',
    variant === 'active'
      ? 'font-semibold text-[var(--color-action-primary-default)]'
      : variant === 'hover'
      ? 'font-normal text-[var(--color-neutral-4)]'
      : 'font-normal text-[var(--color-neutral-black)]',
  );

  return (
    <button
      className={cn(baseStyles, className)}
      aria-current={variant === 'active' ? 'page' : undefined}
      {...props}
    >
      {icon && <span style={{ color: iconColor }}>{icon}</span>}
      {(label || children) && (
        <span className={labelStyles}>
          {label || children}
        </span>
      )}
    </button>
  );
}