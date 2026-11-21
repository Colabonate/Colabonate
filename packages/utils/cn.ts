/**
 * cn – classname utility
 * Verbindet Klassen-Strings, filtert Falsy-Werte heraus.
 * Leichtgewichtige Alternative zu clsx/classnames – keine externe Abhängigkeit.
 */
export function cn(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(' ');
}
