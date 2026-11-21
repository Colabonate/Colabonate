export type LogoBrand = 'colabonate' | 'colabobuy' | 'colabonow' | 'colabosell';
export type LogoTheme = 'default' | 'on-white' | 'on-dark';

export interface LogoProps {
  /** Welche Marke / Sub-Brand soll dargestellt werden */
  brand?: LogoBrand;
  /** Hintergrundkontext – steuert die Farbvariante des SVG */
  theme?: LogoTheme;
  className?: string;
  /** Gewünschte Höhe in px – Breite wird proportional berechnet */
  height?: number;
}
