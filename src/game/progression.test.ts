import { describe, expect, it } from 'vitest';
import { levelFor, levelProgress, objectMeter, pillarMeter, thresholds } from './progression';
import { setQuestDone } from './quests';
import { newGame } from './testutil';

describe('progresión', () => {
  it('nivel 1 con 0 XP y 10 como máximo', () => {
    expect(levelFor(0, 'normal')).toBe(1);
    expect(levelFor(149, 'normal')).toBe(1);
    expect(levelFor(150, 'normal')).toBe(2);
    expect(levelFor(1e9, 'normal')).toBe(10);
  });

  it('umbrales estrictamente crecientes en todas las intensidades', () => {
    for (const i of ['suave', 'normal', 'intensa'] as const) {
      const th = thresholds(i);
      expect(th).toHaveLength(10);
      for (let k = 1; k < th.length; k++) expect(th[k]).toBeGreaterThan(th[k - 1]);
    }
    expect(thresholds('suave')[9]).toBeLessThan(thresholds('normal')[9]);
  });

  it('progreso dentro del nivel', () => {
    const p = levelProgress(325, 'normal');
    expect(p.level).toBe(2);
    expect(p.pct).toBeCloseTo(0.5);
    expect(levelProgress(20000, 'normal')).toMatchObject({ level: 10, to: null, pct: 1 });
  });

  it('el medidor de luz del pilar sube al cumplir y se nota en su objeto', () => {
    const s = newGame();
    const d = '2026-10-05';
    expect(pillarMeter(s, 'cuerpo', d)).toBe(0);
    setQuestDone(s, 'cuerpo-mover', d, true);
    expect(pillarMeter(s, 'cuerpo', d)).toBeGreaterThan(0.4);
    expect(objectMeter(s, 'mat', d)).toBeGreaterThan(0.4);
    expect(objectMeter(s, 'bed', d)).toBe(0);
  });
});
