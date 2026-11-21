/**
 * Colabonate – Navigationshierarchie (Typen)
 *
 * Single Source of Truth für alle Routen, Untermenüs und Navigation-Metadaten.
 * Abgeleitet aus Figma-Screens (2026-03-25) und ADR-026.
 *
 * @see docs/decisions/026-navigation-hierarchy-route-config.md
 */

/** Release-Phase: v1 = aktueller Release, v2 = Ausbaustufe (nur Stub) */
export type NavPhase = 'v1' | 'v2';

/**
 * Einzelner Untermenü-Eintrag.
 * Wird als Dashboard-Karte (mode="cards") und in der
 * Floating Context Page (mode="list") gerendert. (ADR-027)
 */
export interface NavSubItem {
  /** Angezeigter Label */
  label: string;
  /** Beschreibung für Dashboard-Karten */
  description?: string;
  /** Icon-Key (SVG-Name aus MainMenu Icon-Library) */
  icon?: string;
  /** Ziel-Pfad */
  path: string;
  /** Badge-Text (z. B. "NEU", "BETA") */
  badge?: string;
}

/**
 * Einzelner Routen-Eintrag in der Navigationshierarchie.
 * Kinder-Routen sind React Router kompatibel.
 */
export interface NavRoute {
  /** Eindeutiger URL-Pfad (React Router kompatibel, mit :param für dynamische Segmente) */
  path: string;
  /** Angezeigter Label (DE) */
  label: string;
  /** Kurzbeschreibung für Dashboard-Karten und Floating Context Pages */
  description?: string;
  /** Icon-Key für Hauptmenü-Tab und Untermenü-Karten */
  icon?: string;
  /** Figma-Frame-Namen als Design-Referenz */
  figmaFrames?: string[];
  /**
   * Untermenü-Einträge (ADR-027).
   * Werden als Dashboard-Karten im Content-Bereich UND
   * in der Floating Context Page gerendert.
   */
  subItems?: NavSubItem[];
  /** Kinder-Routen für React Router (verschachtelte Routes) */
  children?: NavRoute[];
  /** Erscheint als Tab in der Hauptnavigation (Bottom Nav / Top Bar) */
  isTab?: boolean;
  /**
   * Options-Button `···` ist auf dieser Seite sichtbar.
   * Der Options-Button steuert Komponenten der aktuellen Seite
   * (Filter, Ansicht, Sortierung, Kontext-Aktionen). (ADR-027)
   */
  hasOptions?: boolean;
  /**
   * Listen-Items dieser Route können favorisiert werden.
   * Gefilterte Ansicht via Query-Parameter `?favorites=true`. (ADR-028)
   */
  isFavoritable?: boolean;
  /** Seite erfordert eingeloggten Nutzer */
  requiresAuth?: boolean;
  /**
   * Release-Phase.
   * v1 = aktueller Release (default).
   * v2 = Ausbaustufe: Route existiert als Stub, wird von getV1Routes() herausgefiltert.
   */
  phase?: NavPhase;
  /** Ziel für Redirect (z. B. '/coop/:projectId') */
  redirectTo?: string;
}

/** Vollständige Navigation-Konfiguration */
export interface NavConfig {
  routes: NavRoute[];
}
