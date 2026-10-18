/** Qualité sonore d'un fichier, déduite de son format et de son débit binaire (en kbit/s). */
export type QualityLevel = 'lossless' | 'high' | 'good' | 'low' | 'poor' | 'unknown';

export interface Quality {
  level: QualityLevel;
  /** « Sans perte », « Très bon »… */
  label: string;
  /** « MP3 · 320 kbit/s » */
  text: string;
}

const LOSSLESS = new Set(['FLAC', 'WAV', 'AIFF', 'AIF', 'APE', 'WV', 'ALAC']);
// Ces formats donnent à débit égal un son plus fidèle que le MP3 : on les juge avec un peu plus d'indulgence.
const EFFICIENT = new Set(['M4A', 'AAC', 'OGG', 'OPUS']);

const LABELS: Record<QualityLevel, string> = {
  lossless: 'Sans perte',
  high: 'Très bon',
  good: 'Bon',
  low: 'Moyen',
  poor: 'Faible',
  unknown: 'Qualité inconnue',
};

export function audioQuality(format: string, bitrate: number | null | undefined): Quality {
  const fmt = format.toUpperCase();
  const kbps = bitrate && bitrate > 0 ? Math.round(bitrate) : null;
  const text = kbps ? `${fmt} · ${kbps} kbit/s` : fmt;
  let level: QualityLevel;
  if (LOSSLESS.has(fmt)) level = 'lossless';
  // Un M4A à plus de 600 kbit/s ne peut être que du sans-perte (ALAC).
  else if (kbps === null) level = 'unknown';
  else if (fmt === 'M4A' && kbps >= 600) level = 'lossless';
  else {
    const eq = EFFICIENT.has(fmt) ? kbps * 1.35 : kbps;
    level = eq >= 256 ? 'high' : eq >= 192 ? 'good' : eq >= 128 ? 'low' : 'poor';
  }
  return { level, label: LABELS[level], text };
}
