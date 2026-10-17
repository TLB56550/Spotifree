import { describe, expect, it } from 'vitest';
import { DEVICES, STYLES, mix } from './sound';

describe('égaliseur', () => {
  it('neutre + standard ne change rien', () => {
    expect(mix('standard', 'neutral')).toEqual({ gains: [0, 0, 0, 0, 0, 0], preamp: -0 });
  });
  it('cumule appareil et ambiance', () => {
    const m = mix('headphones', 'rock');
    expect(m.gains).toEqual([6, 3, -2, 1, 2, 3]);
  });
  it('baisse toujours le volume du plus grand renforcement (pas de saturation)', () => {
    for (const d of DEVICES) {
      for (const s of STYLES) {
        const m = mix(d.id, s.id);
        expect(m.preamp).toBeLessThanOrEqual(0);
        expect(Math.max(...m.gains) + m.preamp).toBeLessThanOrEqual(0.0001);
        expect(m.gains).toHaveLength(6);
        for (const g of m.gains) expect(Math.abs(g)).toBeLessThanOrEqual(12);
      }
    }
  });
  it('les identifiants inconnus retombent sur neutre', () => {
    expect(mix('x' as never, 'y' as never).gains).toEqual([0, 0, 0, 0, 0, 0]);
  });
});
