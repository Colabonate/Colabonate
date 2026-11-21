import type { FormEvent, HTMLAttributes, ReactNode } from 'react';

export type FooterVariant = 'extended' | 'minimal';

export type NewsletterStatus = 'idle' | 'loading' | 'success' | 'error';

export interface FooterNewsletterState {
  /** Aktueller Wert des E-Mail-Inputs (controlled) */
  email: string;
  /** Callback bei Eingabeänderung */
  onEmailChange: (value: string) => void;
  /** Callback beim Absenden des Formulars */
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  /** Aktueller Request-Status */
  status?: NewsletterStatus;
  /** Fehlermeldung, wenn `status === 'error'` */
  errorMessage?: string;
}

export interface FooterProps extends HTMLAttributes<HTMLElement> {
  /** Welche Footer-Variante gerendert werden soll */
  variant?: FooterVariant;
  /** SPA-Navigation-Callback für interne Links (verhindert Full-Page-Reload) */
  onNavigate?: (href: string) => void;
  /** Kleines Status-Badge, z. B. für den aktuellen App-Zustand (Beta, Alpha, …) */
  stateBadge?: ReactNode;
  /** Versionsnummer der App – wird klein neben dem Status-Badge angezeigt */
  version?: string;
  /** Controlled State für den Newsletter-Signup (nur `variant="extended"`) */
  newsletter?: FooterNewsletterState;
}

export interface FooterLinkSectionProps {
  /** Überschrift der Sektion */
  title: string;
  /** Links in dieser Sektion */
  links: FooterLink[];
}

export interface FooterLink {
  /** Angezeigter Text */
  label: string;
  /** Ziel-URL oder Route-Pfad */
  href: string;
  /** `true` für externe Links (öffnen in neuem Tab) */
  external?: boolean;
}

export interface FooterNewsletterProps extends FooterNewsletterState {
  /** Überschrift */
  title: string;
  /** Beschreibungstext */
  description: string;
  /** Placeholder für E-Mail-Input */
  placeholder?: string;
  /** Button-Text */
  buttonText: string;
  /** Text, der nach erfolgreichem Signup anstelle des Buttons erscheint */
  successMessage?: string;
}
