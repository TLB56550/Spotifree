import { audioQuality } from '../lib/quality';

/** Format et débit binaire du fichier en cours, avec un code couleur : vert = très bonne qualité, orange/rouge = faible. */
export function QualityBadge({ format, bitrate, className = '' }: { format: string; bitrate: number | null; className?: string }) {
  const q = audioQuality(format, bitrate);
  return (
    <span className={`quality q-${q.level} ${className}`} title={`Qualité du fichier : ${q.label.toLowerCase()}`}>
      <i className="quality-dot" aria-hidden="true" />
      <span className="quality-text">{q.text}</span>
      <span className="sr-only">, qualité : {q.label.toLowerCase()}</span>
    </span>
  );
}
