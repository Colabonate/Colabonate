/**
 * PageContainer & PageSection – Colabonate Design System
 * 
 * Zentraler Container für Page-Content.
 * 
 * Features:
 * - Responsive Padding (mobile-first)
 * - Max-Width Kontrolle
 * - Navigation Safe-Area Abstände (synced mit MainMenu)
 * - Design Token Integration
 * 
 * @see docs/skills/RESPONSIVE-DESIGN.md
 */

import { forwardRef, type HTMLAttributes, type ReactNode } from 'react';
import { cn, useIsMobile } from '@ds/utils';
import type { PageContainerProps, PageSectionProps, PageSize } from './page-container.types';

// ─── PageContainer ─────────────────────────────────────────────────────────────

/**
 * PageContainer
 * 
 * Zentraler Wrapper für den Seiten-Content.
 * 
 * @example
 * // Account Page (narrow)
 * <PageContainer size="narrow">
 *   <PageHeader title="Account" />
 *   <PageSection>...</PageSection>
 * </PageContainer>
 * 
 * @example
 * // Home Page (standard, kein extra top-padding wegen Hero)
 * <PageContainer size="standard" withNavPadding={false}>
 *   <Hero />
 *   <PageSection>...</PageSection>
 * </PageContainer>
 */
export const PageContainer = forwardRef<HTMLDivElement, PageContainerProps>(
  (
    {
      children,
      size = 'wide',
      spacing = 'lg',
      gap = 'lg',
      centered = true,
      withNavPadding = true,
      className,
      ...props
    },
    ref,
  ) => {
    const isMobile = useIsMobile();

    // Max-width mapping
    const maxWidthClasses: Record<PageSize, string> = {
      narrow: '!max-w-[720px]',
      standard: '!max-w-[1400px]',
      wide: '!max-w-[1600px]',
      full: '!max-w-full',
    };

    // Vertical spacing (margin-top between header and content)
    // Mobile: Layout.tsx py provides sufficient breathing room → start at mt-0
    // Desktop: normal spacing applies from md breakpoint
    const spacingClasses: Record<NonNullable<PageContainerProps['spacing']>, string> = {
      none: 'mt-0',
      sm: 'mt-0 md:mt-4',
      md: 'mt-0 md:mt-5 lg:mt-6',
      lg: 'mt-0 md:mt-5 lg:mt-7',
    };

    // Gap between children
    const gapClasses: Record<NonNullable<PageContainerProps['gap']>, string> = {
      none: '',
      sm:   'flex flex-col gap-4',
      md:   'flex flex-col gap-6',
      lg:   'flex flex-col gap-6 md:gap-8',
    };

    // Nav padding (top offset for MainMenu)
    // Mobile: nav is sticky in flex layout → no extra pt needed (Layout.tsx already
    //   positions main content below the sticky nav; pt-[58px] was double-counting).
    // Desktop: top bar is sticky at top → content needs pt-[68px] offset.
    const navPaddingClass = withNavPadding
      ? isMobile
        ? '' // sticky nav in flex layout; Layout.tsx py handles the gap
        : 'pt-[68px]' // Desktop Top Bar
      : '';

    return (
      <div
        ref={ref}
        className={cn(
          'w-full',
          'mx-auto',
          centered && 'px-4 sm:px-4 md:px-6 lg:px-8',
          maxWidthClasses[size],
          navPaddingClass,
          spacingClasses[spacing],
          gapClasses[gap],
          'pb-8',
          isMobile && 'pb-[calc(58px+env(safe-area-inset-bottom,0px)+16px)]',
          className,
        )}
        {...props}
      >
        {children}
      </div>
    );
  },
);

PageContainer.displayName = 'PageContainer';

// ─── PageSection ───────────────────────────────────────────────────────────────

/**
 * PageSection
 * 
 * Vertikaler Abschnitt innerhalb einer Page.
 * Nutzt Design-Tokens für konsistente Abstände.
 * 
 * @example
 * <PageContainer>
 *   <PageSection spacing="lg">
 *     <Typography variant="h4">Meine Tickets</Typography>
 *   </PageSection>
 *   <PageSection spacing="md">
 *     <StatsStrip tickets={tickets} />
 *   </PageSection>
 *   <PageSection spacing="lg" withBorder>
 *     <TicketList />
 *   </PageSection>
 * </PageContainer>
 */
export const PageSection = forwardRef<HTMLDivElement, PageSectionProps>(
  (
    {
      children,
      spacing = 'md',
      withBorder = false,
      className,
      ...props
    },
    ref,
  ) => {
    // Vertical spacing classes
    const spacingClasses: Record<NonNullable<PageSectionProps['spacing']>, string> = {
      none: '',
      sm: 'mt-4',
      md: 'mt-4 md:mt-5',
      lg: 'mt-5 md:mt-6',
      xl: 'mt-5 md:mt-8',
    };

    return (
      <div
        ref={ref}
        className={cn(
          spacingClasses[spacing],
          withBorder && 'border-t border-[var(--theme-border)] pt-4 md:pt-5',
          className,
        )}
        {...props}
      >
        {children}
      </div>
    );
  },
);

PageSection.displayName = 'PageSection';

// ─── PageHeader ────────────────────────────────────────────────────────────────

export interface PageHeaderProps extends HTMLAttributes<HTMLDivElement> {
  /** Titel der Seite */
  title: string;
  /** Optionaler Untertitel */
  subtitle?: string;
  /** Optionale Actions (Buttons etc.) rechts vom Titel */
  actions?: ReactNode;
}

/**
 * PageHeader
 *
 * Standardisierter Header für Pages.
 * Enthält Titel, optionalen Untertitel und Actions.
 *
 * @example
 * <PageHeader
 *   title="Meine Tickets"
 *   subtitle="Verwalte deine Käufe, Verkäufe und Streitfälle"
 *   actions={<Button>Neues Ticket</Button>}
 * />
 */
export const PageHeader = forwardRef<HTMLDivElement, PageHeaderProps>(
  (
    {
      title,
      subtitle,
      actions,
      className,
      ...props
    },
    ref,
  ) => {
    return (
      <div
        ref={ref}
        className={cn(
          'flex flex-col gap-0',
          'sm:flex-row sm:items-start sm:justify-between sm:gap-4',
          className,
        )}
        {...props}
      >
        <div className='flex flex-col gap-0.5'>
          <h4
            className={cn(
              'text-xl font-bold',
              'md:text-xl',
              'text-[var(--theme-text-muted)]',
              'leading-tight',
            )}
          >
            {title}
          </h4>
          {subtitle && (
            <p
              className={cn(
                'text-sm text-[var(--theme-text-muted)]',
                'mt-0.5',
              )}
            >
              {subtitle}
            </p>
          )}
        </div>

        {actions && (
          <div className='flex items-center gap-2 mt-2 sm:mt-0 flex-shrink-0'>
            {actions}
          </div>
        )}
      </div>
    );
  },
);

PageHeader.displayName = 'PageHeader';

// ─── PageCard ─────────────────────────────────────────────────────────────────

export interface PageCardProps extends HTMLAttributes<HTMLDivElement> {
  /** Content der Card */
  children: ReactNode;
  /** Ob die Card padding haben soll */
  padded?: boolean;
  /** Ob die Card einenborder haben soll */
  bordered?: boolean;
}

/**
 * PageCard
 * 
 * Einfache Card-Komponente für Page-Content.
 * Nutzt Design-Tokens für konsistentes Styling.
 */
export const PageCard = forwardRef<HTMLDivElement, PageCardProps>(
  (
    {
      children,
      padded = true,
      bordered = true,
      className,
      ...props
    },
    ref,
  ) => {
    return (
      <div
        ref={ref}
        className={cn(
          'bg-[var(--theme-surface)]',
          'rounded-lg',
          bordered && 'border border-[var(--theme-border)]',
          padded && 'p-4 md:p-5',
          className,
        )}
        {...props}
      >
        {children}
      </div>
    );
  },
);

PageCard.displayName = 'PageCard';
