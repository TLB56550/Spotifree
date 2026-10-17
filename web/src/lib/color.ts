import { useEffect, useState } from 'react';

const cache = new Map<string, string | null>();

/** Couleur moyenne d'une image, adoucie pour servir de fond. Renvoie null tant que l'image n'est pas lue. */
export function useDominantColor(src: string | null | undefined): string | null {
  const [color, setColor] = useState<string | null>(src ? (cache.get(src) ?? null) : null);

  useEffect(() => {
    if (!src) {
      setColor(null);
      return;
    }
    if (cache.has(src)) {
      setColor(cache.get(src) ?? null);
      return;
    }
    let cancelled = false;
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      let result: string | null = null;
      try {
        const size = 24;
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = size;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (ctx) {
          ctx.drawImage(img, 0, 0, size, size);
          const { data } = ctx.getImageData(0, 0, size, size);
          let r = 0;
          let g = 0;
          let b = 0;
          let weight = 0;
          for (let i = 0; i < data.length; i += 4) {
            const pr = data[i]!;
            const pg = data[i + 1]!;
            const pb = data[i + 2]!;
            const max = Math.max(pr, pg, pb);
            const min = Math.min(pr, pg, pb);
            const lightness = (max + min) / 510;
            if (lightness < 0.08 || lightness > 0.94) continue;
            const w = 0.15 + (max - min) / 255; // les couleurs vives comptent davantage
            r += pr * w;
            g += pg * w;
            b += pb * w;
            weight += w;
          }
          if (weight > 0) {
            r /= weight;
            g /= weight;
            b /= weight;
            // On assombrit pour garder un texte blanc lisible.
            const peak = Math.max(r, g, b);
            const k = peak > 120 ? 120 / peak : 1;
            result = `rgb(${Math.round(r * k)}, ${Math.round(g * k)}, ${Math.round(b * k)})`;
          }
        }
      } catch {
        result = null;
      }
      cache.set(src, result);
      if (!cancelled) setColor(result);
    };
    img.onerror = () => {
      cache.set(src, null);
    };
    img.src = src;
    return () => {
      cancelled = true;
    };
  }, [src]);

  return color;
}
