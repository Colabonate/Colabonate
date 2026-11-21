/**
 * PageContainer – Types
 * 
 * Zentraler Container für Page-Content mit:
 * - Responsive Padding
 * - Max-Width Kontrolle
 * - Navigation Safe-Area Abstände
 */

import type { HTMLAttributes, ReactNode } from 'react';

/** Preset für die maximale Breite einer Seite */
export type PageSize = 'narrow' | 'standard' | 'wide' | 'full';

/** Varianten für das Container-Design */
export type PageVariant = 'default' | 'cards' | 'list';

export interface PageContainerProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  /** 
   * Content der Seite.
   * Erlaubt zusätzliche Wrapper-Elemente wenn nötig.
   */
  children?: ReactNode;
  
  /**
   * Preset für die maximale Breite:
   * - narrow:   720px  (z.B. Account Page)
   * - standard: 1100px (z.B. Offers, Tickets, Home)
   * - wide:     1200px (z.B. Dashboard mit vielen Widgets)
   * - full:     100%   (z.B. Map, Fullscreen Modal)
   * 
   * @default 'standard'
   */
  size?: PageSize;
  
  /**
   * Vertical spacing zwischen Page-Header und Content.
   * - none:    Kein spacing (0)
   * - sm:      Kompakt (16px)
   * - md:      Standard (20px mobile, 24px desktop)
   * - lg:      Großzügig (32px mobile, 40px desktop)
   *
   * @default 'lg'
   */
  spacing?: 'none' | 'sm' | 'md' | 'lg';

  /**
   * Gap zwischen den direkten Kinder-Elementen (flex column).
   * - none: kein Gap
   * - sm:   16px
   * - md:   24px
   * - lg:   32px mobile / 40px desktop
   *
   * @default 'lg'
   */
  gap?: 'none' | 'sm' | 'md' | 'lg';
  
  /**
   * Ob der Container horizontal zentriert werden soll.
   * @default true
   */
  centered?: boolean;
  
  /**
   * Ob Padding für die Navigation berücksichtigt werden soll.
   * Setzt automatisch margin-top basierend auf:
   * - Mobile: 58px (Bottom Nav)
   * - Desktop: 68px (Top Bar)
   * 
   * @default true
   */
  withNavPadding?: boolean;
  
  /**
   * Optionale CSS-Klasse für den äußeren Container.
   * Überschreibt interne Styles nicht.
   */
  className?: string;
}

export interface PageSectionProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  /** Content der Sektion */
  children?: ReactNode;
  
  /**
   * Vertical spacing zur vorherigen Sektion.
   * Nutzt Design-Tokens aus tokens.json
   * 
   * @default 'md'
   */
  spacing?: 'none' | 'sm' | 'md' | 'lg' | 'xl';
  
  /**
   * Ob die Sektion eine Border oben haben soll.
   * Nützlich für visuelles Trennen von Sektionen.
   * 
   * @default false
   */
  withBorder?: boolean;
  
  /**
   * Optionale CSS-Klasse.
   */
  className?: string;
}

export interface PageHeaderProps extends HTMLAttributes<HTMLDivElement> {
  /** Titel der Seite */
  title: string;
  /** Optionaler Untertitel */
  subtitle?: string;
  /** Optionale Actions (Buttons etc.) rechts vom Titel */
  actions?: ReactNode;
}

export interface PageCardProps extends HTMLAttributes<HTMLDivElement> {
  /** Content der Card */
  children: ReactNode;
  /** Ob die Card padding haben soll */
  padded?: boolean;
  /** Ob die Card einenborder haben soll */
  bordered?: boolean;
}
