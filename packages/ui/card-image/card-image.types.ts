import type { HTMLAttributes, ReactNode } from 'react';

export interface CardImageProps extends HTMLAttributes<HTMLDivElement> {
  /** Image source. While it loads, a shimmer skeleton is shown instead of alt text. */
  src?: string;
  /** Alt text for the image (also used as accessible label once loaded). */
  alt: string;
  /** Rendered when there is no `src` or the image fails to load (e.g. initial-letter fallback). */
  fallback?: ReactNode;
  /** Additional classes for the inner `<img>` (e.g. `group-hover:scale-[1.06]`). */
  imgClassName?: string;
}
