import type { ButtonHTMLAttributes, ReactNode } from 'react';

/**
 * NavButton – Navigation Button for MainMenu
 * 
 * A compact button component designed for bottom/top navigation bars.
 * Displays an icon with an optional label below.
 * 
 * @example
 * ```tsx
 * <NavButton 
 *   icon={<IconHome />}
 *   label="Home"
 *   variant="active"
 *   onClick={() => navigate('/')}
 * />
 * ```
 */
export interface NavButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  /** Visual state of the button */
  variant?: 'default' | 'active' | 'hover';
  
  /** Size variant for the nav button */
  size?: 'small' | 'medium';
  
  /** Icon element to display above label */
  icon?: ReactNode;
  
  /** Label text displayed below icon */
  label?: string;
  
  /** Whether the button takes full available width */
  fullWidth?: boolean;
}