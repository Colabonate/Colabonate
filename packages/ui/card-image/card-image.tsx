import { useCallback, useState } from 'react';
import { Skeleton } from '@mui/material';
import { cn } from '@ds/utils';
import type { CardImageProps } from './card-image.types';

type LoadStatus = 'loading' | 'loaded' | 'error';

/**
 * Card image area with an elegant loading state: while the browser fetches
 * (or queues) the image, a wave shimmer skeleton fills the area — never the
 * raw alt/title string. Once loaded, the image crossfades in. On error or
 * when no `src` exists, the caller-provided `fallback` is shown.
 */
export function CardImage({ src, alt, fallback, className, imgClassName, ...props }: CardImageProps) {
  const [status, setStatus] = useState<LoadStatus>(src ? 'loading' : 'error');
  const [seenSrc, setSeenSrc] = useState(src);

  // Reset the load state when a mounted card swaps its image (e.g. list
  // refetch replaces the item) — the "adjust state during render" pattern.
  if (seenSrc !== src) {
    setSeenSrc(src);
    setStatus(src ? 'loading' : 'error');
  }

  // Images restored from the browser cache can finish loading before React
  // attaches the onLoad listener — the load event then never fires and the
  // shimmer would run forever. Check the element's `complete` flag when the
  // ref attaches to close that race.
  const attachImg = useCallback((el: HTMLImageElement | null) => {
    if (el?.complete) {
      setStatus(el.naturalWidth > 0 ? 'loaded' : 'error');
    }
  }, []);

  const reducedMotion =
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  return (
    <div className={cn('relative overflow-hidden', className)} {...props}>
      {src && status !== 'error' && (
        <img
          ref={attachImg}
          src={src}
          alt={alt}
          draggable={false}
          onLoad={() => setStatus('loaded')}
          onError={() => setStatus('error')}
          className={cn(
            'absolute inset-0 w-full h-full object-cover select-none',
            'transition-[opacity,transform] duration-500 ease-out',
            status === 'loaded' ? 'opacity-100' : 'opacity-0',
            imgClassName,
          )}
        />
      )}

      {src && status === 'loading' && (
        <Skeleton
          variant="rectangular"
          width="100%"
          height="100%"
          animation={reducedMotion ? false : 'wave'}
          className="absolute inset-0"
          aria-hidden="true"
        />
      )}

      {(!src || status === 'error') && fallback}
    </div>
  );
}
